import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import type { EvidenceExtractionOutput } from "@/ai/evidence-extractor/contracts";
import { InitialIntakeUnavailableError } from "@/domain/initial-intake";
import { BusinessArchivedError } from "@/repositories/business-lifecycle-guard";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { InitialIntakeRepository } from "@/repositories/initial-intake-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { InitialIntakeService } from "@/services/initial-intake-service";
import { baslonExtractionOutput, baslonMessyIntake } from "./baslon-business";

export function initialIntakeScenarios(getDatabase: () => Database) {
  async function setup() {
    const db = getDatabase();
    const foundation = new FoundationRepository(db);
    const business = await new BusinessService(foundation).create({
      name: `Initial intake ${randomUUID()}`,
    });
    let failModel = false;
    let modelOutput: EvidenceExtractionOutput = structuredClone(baslonExtractionOutput);
    const runs = new EvidenceExtractionRepository(db);
    const extraction = new EvidenceExtractionService(runs, {
      getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
      extract: async () => {
        if (failModel) throw new Error("forced model failure");
        return { output: structuredClone(modelOutput), rawOutput: {} };
      },
    });
    const intakeRepository = new InitialIntakeRepository(db);
    const service = new InitialIntakeService(intakeRepository, extraction);
    const reviews = new EvidenceReviewService(
      new EvidenceReviewRepository(db),
      createStrategyOrchestrator(db),
    );
    async function state() {
      const workflow = await foundation.getWorkflow(business.id);
      return {
        workflow,
        transitions: await foundation.getTransitionHistory(workflow!.id),
        runs: await db.select().from(s.evidenceExtractionRuns)
          .where(eq(s.evidenceExtractionRuns.businessId, business.id))
          .orderBy(s.evidenceExtractionRuns.createdAt, s.evidenceExtractionRuns.id),
      };
    }
    return {
      db, business, foundation, runs, extraction, intakeRepository, service, reviews, state,
      fail: (value: boolean) => { failModel = value; },
      output: (value: EvidenceExtractionOutput) => { modelOutput = value; },
    };
  }

  async function unavailable(promise: Promise<unknown>) {
    const error = await promise.then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(InitialIntakeUnavailableError);
    return (error as InitialIntakeUnavailableError).availability;
  }

  it("moves a new Business to EVIDENCE_PROCESSING and creates its run in one command", async () => {
    const c = await setup();
    const result = await c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake });
    const after = await c.state();
    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.run.sourceType).toBe("business_intake");
    expect(result.run.sourceSubmissionId).toBeNull();
    expect(after.workflow?.state).toBe("EVIDENCE_PROCESSING");
    expect(after.transitions.map((item) => item.event))
      .toEqual(["START_INTAKE", "SUBMIT_INTAKE", "PROCESS_EVIDENCE"]);
    expect(after.runs).toHaveLength(1);
  });

  it("rolls back every intake transition when the run cannot be created", async () => {
    const c = await setup();
    const error = await c.intakeRepository.prepare({
      businessId: c.business.id,
      // A null prompt version violates the run's NOT NULL constraint after the transitions.
      runStart: { ...c.extraction.prepare({
        businessId: c.business.id,
        rawIntakeText: baslonMessyIntake,
        sourceType: "business_intake",
      }).runStart, promptVersion: null as unknown as string },
    }).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const after = await c.state();
    expect(after.workflow?.state).toBe("NEW");
    expect(after.transitions).toHaveLength(0);
    expect(after.runs).toHaveLength(0);
  });

  it("rejects resubmission while a successful intake awaits review and keeps that review completable", async () => {
    const c = await setup();
    const first = await c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake });
    const session = await c.reviews.startReview({
      businessId: c.business.id, extractionRunId: first.run.id, reviewerId: "test-human",
    });
    const details = await c.reviews.getReview(session.id, c.business.id);
    const claim = details.proposals.find((proposal) => proposal.proposalType === "claim")!;
    await c.reviews.reviewProposal({
      businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human",
      proposalId: claim.id, decision: "ACCEPTED",
    });

    expect(await unavailable(c.service.submit({
      businessId: c.business.id, rawIntakeText: "Replacement intake text",
    }))).toEqual({ kind: "review_in_progress", runId: first.run.id });
    expect(await c.service.getAvailability(c.business.id))
      .toEqual({ kind: "review_in_progress", runId: first.run.id });
    expect((await c.state()).runs.map((run) => run.id)).toEqual([first.run.id]);

    for (const proposal of details.proposals.filter((item) => item.id !== claim.id)) {
      await c.reviews.reviewProposal({
        businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human",
        proposalId: proposal.id, decision: "REJECTED",
      });
    }
    const completed = await c.reviews.completeReview({
      businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human",
    });
    expect(completed.completedNow).toBe(true);
    expect((await c.state()).workflow?.state).toBe("EVIDENCE_READY");
    expect(await c.service.getAvailability(c.business.id)).toEqual({ kind: "use_add_information" });
    expect(await unavailable(c.service.submit({
      businessId: c.business.id, rawIntakeText: "Later intake text",
    }))).toEqual({ kind: "use_add_information" });
  });

  it("permits a new intake attempt after a failed run without repeating intake transitions", async () => {
    const c = await setup();
    c.fail(true);
    await expect(c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake }))
      .rejects.toThrow();
    const failed = await c.state();
    expect(failed.runs.map((run) => run.status)).toEqual(["FAILED"]);
    expect(await c.service.getAvailability(c.business.id)).toEqual({ kind: "available" });

    c.fail(false);
    const retry = await c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake });
    const after = await c.state();
    expect(retry.run.status).toBe("SUCCEEDED");
    expect(after.runs).toHaveLength(2);
    expect(after.transitions).toHaveLength(3);
  });

  it("rejects a fresh RUNNING intake but recovers an abandoned one before starting again", async () => {
    const c = await setup();
    const abandoned = await c.intakeRepository.prepare({
      businessId: c.business.id,
      runStart: c.extraction.prepare({
        businessId: c.business.id,
        rawIntakeText: baslonMessyIntake,
        sourceType: "business_intake",
      }).runStart,
    });
    expect(await unavailable(c.service.submit({
      businessId: c.business.id, rawIntakeText: baslonMessyIntake,
    }))).toEqual({ kind: "analysis_running", runId: abandoned.id });

    vi.stubEnv("AI_RUN_STALE_AFTER_MS", "1");
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(await c.service.getAvailability(c.business.id))
        .toEqual({ kind: "available", staleRunId: abandoned.id });
      const retry = await c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake });
      expect(retry.run.id).not.toBe(abandoned.id);
      expect(await c.runs.getRun(abandoned.id, c.business.id)).toMatchObject({
        status: "FAILED",
        validationErrors: expect.arrayContaining([
          expect.objectContaining({ code: "stale_run_recovered" }),
        ]),
      });
      expect((await c.state()).transitions).toHaveLength(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects initial intake for an archived Business without changing its workflow", async () => {
    const c = await setup();
    await c.foundation.archiveBusiness(c.business.id);
    await expect(c.service.submit({ businessId: c.business.id, rawIntakeText: baslonMessyIntake }))
      .rejects.toBeInstanceOf(BusinessArchivedError);
    const after = await c.state();
    expect(after.workflow?.state).toBe("NEW");
    expect(after.transitions).toHaveLength(0);
    expect(after.runs).toHaveLength(0);
  });
}
