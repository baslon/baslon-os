import { randomUUID } from "node:crypto";
import { count, desc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import type { EvidenceCoherenceModelOutput } from "@/ai/evidence-coherence/contracts";
import { BusinessArchivedError } from "@/repositories/business-lifecycle-guard";
import { AddInformationRepository } from "@/repositories/add-information-repository";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { AddInformationService } from "@/services/add-information-service";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceQualityService } from "@/services/evidence-quality-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { GapResolutionService } from "@/services/gap-resolution-service";
import { SourceSubmissionService } from "@/services/source-submission-service";

type Findings = "none" | "low_only" | "high_question";

/** Reviews evidence, runs Evidence Coherence and returns a Business in GAP_RESOLUTION_REQUIRED. */
export async function createGapResolutionContext(db: Database, findings: Findings) {
  const foundation = new FoundationRepository(db);
  const business = await foundation.createBusiness({ name: `Gap resolution ${randomUUID()}` });
  await foundation.addClaim({
    businessId: business.id, statement: "Most clients come from referrals.",
    claimType: "management_belief", subjectArea: "acquisition",
    confidenceLevel: "medium", sourceType: "test",
  });
  await foundation.createSnapshot(business.id);
  const orchestrator = createStrategyOrchestrator(db);
  for (const [event, actorType] of [
    ["START_INTAKE", "human"], ["SUBMIT_INTAKE", "human"],
    ["PROCESS_EVIDENCE", "system"], ["MARK_ANALYSIS_COMPLETE", "system"],
  ] as const) await orchestrator.transition({ businessId: business.id, event, actorType, actorId: "test" });

  const gap = (materiality: "low" | "high") => ({
    findingRef: "gap_1", area: "customers_and_market" as const,
    missingInformation: "Client acquisition sources are unmeasured.",
    decisionImpact: "Acquisition priorities cannot be compared.",
    materiality, priorityRank: 1,
    // The snapshot's only Claim projects as C001.
    references: [{ entityType: "claim" as const, ref: "C001", role: "primary" as const }],
  });
  const output: EvidenceCoherenceModelOutput = findings === "none"
    ? { contradictions: [], gaps: [], questions: [] }
    : {
      contradictions: [],
      gaps: [gap(findings === "low_only" ? "low" : "high")],
      questions: [{ findingType: "gap", findingRef: "gap_1", question: "Where did your last ten clients come from?", priorityOrder: 1 }],
    };
  const coherence = new EvidenceCoherenceRepository(db);
  const analysis = await new EvidenceCoherenceService(coherence, {
    getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
    analyse: async () => ({ output: structuredClone(output), rawOutput: output }),
  }, orchestrator).analyseCurrentSnapshot({ businessId: business.id });

  const runs = new EvidenceExtractionRepository(db);
  const extraction = new EvidenceExtractionService(runs, {
    getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
    extract: async () => ({ output: { claims: [], evidence: [], metrics: [], relationships: [] }, rawOutput: {} }),
  });
  const reviews = new EvidenceReviewService(new EvidenceReviewRepository(db), orchestrator);
  const addInformation = new AddInformationService(
    new AddInformationRepository(db),
    new SourceSubmissionService(new SourceSubmissionRepository(db)),
    extraction,
    reviews,
  );
  const gaps = new GapResolutionService(coherence, orchestrator);
  const quality = new EvidenceQualityService(coherence);

  async function state() {
    const workflow = await foundation.getWorkflow(business.id);
    return { workflow, transitions: await foundation.getTransitionHistory(workflow!.id) };
  }
  async function analyticalRecords() {
    return {
      runs: await db.select().from(s.analysisRuns).where(eq(s.analysisRuns.businessId, business.id)),
      contradictions: await db.select().from(s.contradictions).where(eq(s.contradictions.businessId, business.id)),
      gaps: await db.select().from(s.evidenceGaps).where(eq(s.evidenceGaps.businessId, business.id)),
      questions: await db.select().from(s.analysisQuestions).where(eq(s.analysisQuestions.businessId, business.id)),
      snapshots: await db.select().from(s.businessStateSnapshots)
        .where(eq(s.businessStateSnapshots.businessId, business.id)),
    };
  }
  async function completeCurrentReview(runId: string) {
    const session = await reviews.startReview({ businessId: business.id, extractionRunId: runId, reviewerId: "test-human" });
    return reviews.completeReview({ businessId: business.id, reviewSessionId: session.id, reviewerId: "test-human" });
  }
  return {
    db, business, foundation, orchestrator, coherence, analysis, addInformation, gaps, quality,
    state, analyticalRecords, completeCurrentReview,
  };
}

export function gapResolutionScenarios(getDatabase: () => Database) {
  const setup = (findings: Findings) => createGapResolutionContext(getDatabase(), findings);

  async function sourceCount(db: Database, businessId: string) {
    const [row] = await db.select({ value: count() }).from(s.sourceSubmissions)
      .where(eq(s.sourceSubmissions.businessId, businessId));
    return row.value;
  }

  for (const findings of ["none", "low_only"] as const) {
    it(`is not stranded when Evidence Coherence surfaces no question (${findings})`, async () => {
      const c = await setup(findings);
      expect(c.analysis.run.status).toBe("SUCCEEDED");
      expect((await c.state()).workflow?.state).toBe("GAP_RESOLUTION_REQUIRED");
      expect((await c.quality.get(c.business.id)).surfacedQuestions).toHaveLength(0);

      const result = await c.addInformation.submit({
        businessId: c.business.id, rawText: "We won three new clients from LinkedIn this quarter.",
      });
      const after = await c.state();
      expect(result.run.status).toBe("SUCCEEDED");
      expect(result.run.sourceSubmissionId).toEqual(expect.any(String));
      expect(after.workflow?.state).toBe("EVIDENCE_PROCESSING");
      expect(after.transitions.at(-1)).toMatchObject({
        event: "ADD_EVIDENCE", fromState: "GAP_RESOLUTION_REQUIRED", actorType: "human",
      });
      expect(await c.db.select().from(s.analysisQuestionSources)
        .where(eq(s.analysisQuestionSources.businessId, c.business.id))).toHaveLength(0);
    });
  }

  it("continues with gaps to PHASE1_READY with a durable human transition and no finding changes", async () => {
    const c = await setup("none");
    const before = await c.state();
    const records = await c.analyticalRecords();
    const [snapshot] = await c.db.select().from(s.businessStateSnapshots)
      .where(eq(s.businessStateSnapshots.businessId, c.business.id))
      .orderBy(desc(s.businessStateSnapshots.version)).limit(1);

    const updated = await c.gaps.continueWithGaps({ businessId: c.business.id });
    const after = await c.state();
    expect(updated).toMatchObject({ state: "PHASE1_READY", version: before.workflow!.version + 1 });
    expect(after.workflow).toMatchObject({ state: "PHASE1_READY", version: before.workflow!.version + 1 });
    expect(after.transitions).toHaveLength(before.transitions.length + 1);
    expect(after.transitions.at(-1)).toMatchObject({
      event: "CONTINUE_WITH_GAPS",
      fromState: "GAP_RESOLUTION_REQUIRED",
      toState: "PHASE1_READY",
      actorType: "human",
      actorId: "business-user",
      metadata: {
        snapshotId: snapshot.id,
        snapshotVersion: snapshot.version,
        analysisRunId: c.analysis.run.id,
        analysisPromptVersion: c.analysis.run.promptVersion,
      },
    });
    expect(await c.analyticalRecords()).toEqual(records);
  });

  it("keeps surfaced questions answerable and still allows continuing past them", async () => {
    const c = await setup("high_question");
    const surfaced = (await c.quality.get(c.business.id)).surfacedQuestions;
    expect(surfaced).toHaveLength(1);
    await c.gaps.continueWithGaps({ businessId: c.business.id });
    expect((await c.state()).workflow?.state).toBe("PHASE1_READY");
    const [question] = await c.db.select().from(s.analysisQuestions).where(eq(s.analysisQuestions.id, surfaced[0].id));
    expect(question).toEqual(expect.objectContaining({ id: surfaced[0].id, question: surfaced[0].question }));
  });

  it("allows only a human actor to continue with gaps", async () => {
    const c = await setup("none");
    const before = await c.state();
    const metadata = { snapshotId: c.analysis.run.inputSnapshotId, analysisRunId: c.analysis.run.id };
    for (const actorType of ["system", "ai"] as const) {
      await expect(c.orchestrator.transition({
        businessId: c.business.id, event: "CONTINUE_WITH_GAPS", actorType, actorId: actorType, metadata,
      })).rejects.toThrow("requires a human actor");
    }
    expect(await c.state()).toEqual(before);
  });

  it("rejects continuing from states other than GAP_RESOLUTION_REQUIRED", async () => {
    const c = await setup("none");
    await c.gaps.continueWithGaps({ businessId: c.business.id });
    const metadata = { snapshotId: c.analysis.run.inputSnapshotId, analysisRunId: c.analysis.run.id };
    await expect(c.orchestrator.transition({
      businessId: c.business.id, event: "CONTINUE_WITH_GAPS", actorType: "human", actorId: "test", metadata,
    })).rejects.toThrow("Invalid workflow transition: PHASE1_READY + CONTINUE_WITH_GAPS");

    const fresh = await c.foundation.createBusiness({ name: `Gap resolution early ${randomUUID()}` });
    await expect(c.gaps.continueWithGaps({ businessId: fresh.id }))
      .rejects.toThrow("A canonical snapshot is required");
    await expect(createStrategyOrchestrator(c.db).transition({
      businessId: fresh.id, event: "CONTINUE_WITH_GAPS", actorType: "human", actorId: "test", metadata,
    })).rejects.toThrow("Invalid workflow transition: NEW + CONTINUE_WITH_GAPS");
  });

  it("requires the latest snapshot to have a successful Evidence Coherence run", async () => {
    const c = await setup("none");
    const before = await c.state();
    const earlierSnapshotId = c.analysis.run.inputSnapshotId;
    // Test-only canonical path: a newer snapshot with no analysis must block Phase 1 entry.
    const newer = await c.foundation.createSnapshot(c.business.id);

    await expect(c.gaps.continueWithGaps({ businessId: c.business.id }))
      .rejects.toThrow("no successful Evidence Coherence analysis");
    for (const metadata of [
      { snapshotId: earlierSnapshotId, analysisRunId: c.analysis.run.id },
      { snapshotId: newer.id, analysisRunId: c.analysis.run.id },
      {},
    ]) {
      await expect(c.orchestrator.transition({
        businessId: c.business.id, event: "CONTINUE_WITH_GAPS", actorType: "human", actorId: "test", metadata,
      })).rejects.toThrow(/latest canonical snapshot|no successful Evidence Coherence analysis|must record/);
    }
    expect(await c.state()).toEqual(before);
  });

  it("rejects continuing with gaps for an archived Business without changing workflow", async () => {
    const c = await setup("none");
    const before = await c.state();
    await c.foundation.archiveBusiness(c.business.id);
    await expect(c.gaps.continueWithGaps({ businessId: c.business.id }))
      .rejects.toBeInstanceOf(BusinessArchivedError);
    expect(await c.state()).toEqual(before);
  });

  it("lets PHASE1_READY return to the normal evidence loop through Add Information", async () => {
    const c = await setup("high_question");
    const [question] = await c.db.select().from(s.analysisQuestions)
      .where(eq(s.analysisQuestions.businessId, c.business.id));
    await c.gaps.continueWithGaps({ businessId: c.business.id });
    const sourcesBefore = await sourceCount(c.db, c.business.id);

    await expect(c.addInformation.submit({
      businessId: c.business.id, questionId: question.id, rawText: "Eight came from referrals.",
    })).rejects.toThrow();
    expect(await sourceCount(c.db, c.business.id)).toBe(sourcesBefore);
    expect((await c.state()).workflow?.state).toBe("PHASE1_READY");

    const result = await c.addInformation.submit({
      businessId: c.business.id, rawText: "Eight of our last ten clients came from referrals.",
    });
    const processing = await c.state();
    expect(processing.workflow?.state).toBe("EVIDENCE_PROCESSING");
    expect(processing.transitions.at(-1)).toMatchObject({
      event: "ADD_EVIDENCE", fromState: "PHASE1_READY", toState: "EVIDENCE_PROCESSING", actorType: "human",
    });
    expect(await sourceCount(c.db, c.business.id)).toBe(sourcesBefore + 1);

    const completed = await c.completeCurrentReview(result.run.id);
    expect(completed.snapshot.version).toBeGreaterThan(1);
    expect((await c.state()).workflow?.state).toBe("EVIDENCE_READY");
  });
}
