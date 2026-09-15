import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { AddInformationService } from "@/services/add-information-service";
import { baslonBusiness, baslonMessyIntake, baslonExtractionOutput } from "./baslon-business";

export function addInformationScenarios(getDatabase: () => Database) {
  async function setup() {
    const db = getDatabase();
    const foundation = new FoundationRepository(db);
    const business = await new BusinessService(foundation).create({ ...baslonBusiness, name: `Continuous evidence ${randomUUID()}` });
    const sources = new SourceSubmissionService(new SourceSubmissionRepository(db));
    const runs = new EvidenceExtractionRepository(db);
    const orchestrator = createStrategyOrchestrator(db);
    const repository = new EvidenceReviewRepository(db);
    const reviews = new EvidenceReviewService(repository, orchestrator);
    let malformed = false;
    const extraction = new EvidenceExtractionService(runs, {
      getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
      extract: async () => ({ output: malformed ? {} : structuredClone(baslonExtractionOutput), rawOutput: {} }),
    });
    const service = new AddInformationService(sources, extraction, reviews, orchestrator);
    async function complete(runId: string) {
      const session = await reviews.startReview({ businessId: business.id, extractionRunId: runId, reviewerId: "test-human" });
      const details = await reviews.getReview(session.id, business.id);
      for (const proposal of details.proposals) {
        await reviews.reviewProposal({ businessId: business.id, reviewSessionId: session.id,
          reviewerId: "test-human", proposalId: proposal.id,
          decision: proposal.proposalRef === "claim_3" ? "UNRESOLVED" : "ACCEPTED" });
      }
      return reviews.completeReview({ businessId: business.id, reviewSessionId: session.id, reviewerId: "test-human" });
    }
    for (const [event, actorType] of [["START_INTAKE", "human"], ["SUBMIT_INTAKE", "human"], ["PROCESS_EVIDENCE", "system"]] as const) {
      await orchestrator.transition({ businessId: business.id, event, actorType });
    }
    const original = await extraction.extract({ businessId: business.id, rawIntakeText: baslonMessyIntake });
    const first = await complete(original.run.id);
    return { db, business, foundation, sources, runs, reviews, repository, service, complete, first,
      fail: (value: boolean) => { malformed = value; } };
  }

  async function canonical(db: Database, businessId: string) {
    return {
      claims: await db.select().from(s.claims).where(eq(s.claims.businessId, businessId)).orderBy(s.claims.id),
      evidence: await db.select().from(s.evidence).where(eq(s.evidence.businessId, businessId)).orderBy(s.evidence.id),
      metrics: await db.select().from(s.metrics).where(eq(s.metrics.businessId, businessId)).orderBy(s.metrics.id),
      links: await db.select().from(s.claimEvidence).where(eq(s.claimEvidence.businessId, businessId)).orderBy(s.claimEvidence.claimId),
      snapshots: await db.select().from(s.businessStateSnapshots).where(eq(s.businessStateSnapshots.businessId, businessId)).orderBy(s.businessStateSnapshots.version),
    };
  }

  it("preserves cumulative state through two additions, explicit reviews and three immutable snapshots", async () => {
    const c = await setup();
    const other = await setup();
    const otherBefore = await canonical(c.db, other.business.id);
    for (const version of [2, 3]) {
      const before = await canonical(c.db, c.business.id);
      const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake, sourceReference: `Addition ${version}` });
      expect(await canonical(c.db, c.business.id)).toEqual(before);
      expect(result.run.sourceSubmissionId).toBeTruthy();
      expect(result.proposals.every(p => p.businessId === c.business.id && p.extractionRunId === result.run.id)).toBe(true);
      await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: c.first.session.id, reviewerId: "test-human" });
      expect((await c.foundation.getWorkflow(c.business.id))?.state).toBe("EVIDENCE_PROCESSING");
      await expect(c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake })).rejects.toThrow("Complete");
      const completed = await c.complete(result.run.id);
      expect(completed.snapshot.version).toBe(version);
      const after = await canonical(c.db, c.business.id);
      expect(after.claims).toEqual(expect.arrayContaining(before.claims));
      expect(after.evidence).toEqual(expect.arrayContaining(before.evidence));
      expect(after.metrics).toEqual(expect.arrayContaining(before.metrics));
      expect(after.links).toEqual(expect.arrayContaining(before.links));
      expect(after.snapshots.slice(0, -1)).toEqual(before.snapshots);
      const payload = completed.snapshot.snapshotData as { evidence: { id: string }[]; claims: { id: string }[]; metrics: { id: string }[] };
      expect(payload.evidence.map(e => e.id).sort()).toEqual(after.evidence.map(e => e.id).sort());
      expect(payload.claims.map(e => e.id).sort()).toEqual(after.claims.map(e => e.id).sort());
      expect(payload.metrics.map(e => e.id).sort()).toEqual(after.metrics.map(e => e.id).sort());
      await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: completed.session.id, reviewerId: "test-human" });
      expect(await canonical(c.db, c.business.id)).toEqual(after);
      await expect(c.reviews.completeReview({ businessId: other.business.id, reviewSessionId: completed.session.id, reviewerId: "test-human" })).rejects.toThrow();
    }
    const sources = await c.sources.listForBusiness(c.business.id);
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map(x => x.id)).size).toBe(2);
    expect(sources.every(x => x.rawText === baslonMessyIntake)).toBe(true);
    expect(await canonical(c.db, other.business.id)).toEqual(otherBefore);
  });

  it("rejects empty input and retains the same immutable source across a failed run and retry", async () => {
    const c = await setup();
    await expect(c.service.submit({ businessId: c.business.id, rawText: "   " })).rejects.toThrow();
    expect(await c.sources.listForBusiness(c.business.id)).toEqual([]);
    const before = await canonical(c.db, c.business.id);
    c.fail(true);
    await expect(c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake })).rejects.toThrow();
    const failed = (await c.runs.getLatestRun(c.business.id))!;
    const sources = await c.sources.listForBusiness(c.business.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.validationErrors.length).toBeGreaterThan(0);
    expect(await c.runs.getProposals(failed.id, c.business.id)).toEqual([]);
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    const other = await setup();
    await expect(c.service.retry({ businessId: other.business.id, runId: failed.id })).rejects.toThrow();
    c.fail(false);
    const retried = await c.service.retry({ businessId: c.business.id, runId: failed.id });
    expect(retried.run.id).not.toBe(failed.id);
    expect(retried.run.sourceSubmissionId).toBe(failed.sourceSubmissionId);
    expect(await c.sources.listForBusiness(c.business.id)).toEqual(sources);
    expect(await c.runs.getRun(failed.id, c.business.id)).toEqual(failed);
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    await expect(c.service.retry({ businessId: c.business.id, runId: failed.id })).rejects.toThrow();
  });

  it("rolls back canonical application if the audit fails during an additional review", async () => {
    const c = await setup();
    const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake });
    const session = await c.reviews.startReview({ businessId: c.business.id, extractionRunId: result.run.id, reviewerId: "test-human" });
    const before = await canonical(c.db, c.business.id);
    await expect(c.repository.applyDecision({ businessId: c.business.id, reviewSessionId: session.id,
      proposalId: result.proposals[0].id, reviewerId: "test-human", decision: "REJECTED", reviewedPayload: null,
      canonical: { type: "claim", values: { businessId: c.business.id, statement: "Must roll back", claimType: "hypothesis", subjectArea: "test", confidenceLevel: "low", sourceType: "test" } },
    })).rejects.toThrow();
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    const details = await c.reviews.getReview(session.id, c.business.id);
    expect(details.reviews).toEqual([]);
    await expect(c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" })).rejects.toThrow("Every proposal");
    // Historical snapshots remain protected independently of the application service.
    await expect(c.db.execute(sql`update business_state_snapshots set version = 99 where id = ${c.first.snapshot.id}`)).rejects.toThrow();
  });

  it("rolls back the new snapshot when review completion fails, preserving earlier human decisions", async () => {
    const c = await setup();
    const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake });
    const session = await c.reviews.startReview({ businessId: c.business.id, extractionRunId: result.run.id, reviewerId: "test-human" });
    for (const proposal of result.proposals) {
      await c.reviews.reviewProposal({ businessId: c.business.id, reviewSessionId: session.id,
        proposalId: proposal.id, reviewerId: "test-human", decision: "ACCEPTED" });
    }
    const before = await canonical(c.db, c.business.id);
    const trigger = `test_completion_${randomUUID().replaceAll("-", "")}`;
    // The trigger is restricted to this test's session and always removed.
    await c.db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${session.id}'::uuid THEN RAISE EXCEPTION 'forced completion failure'; END IF; RETURN NEW; END $$`));
    await c.db.execute(sql.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON evidence_review_sessions FOR EACH ROW EXECUTE FUNCTION ${trigger}()`));
    try {
      await expect(c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" })).rejects.toThrow();
      expect(await canonical(c.db, c.business.id)).toEqual(before);
      expect((await c.reviews.getReview(session.id, c.business.id)).session.status).toBe("OPEN");
      expect((await c.foundation.getWorkflow(c.business.id))?.state).toBe("EVIDENCE_PROCESSING");
    } finally {
      await c.db.execute(sql.raw(`DROP TRIGGER ${trigger} ON evidence_review_sessions`));
      await c.db.execute(sql.raw(`DROP FUNCTION ${trigger}()`));
    }
    const completed = await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" });
    expect(completed.snapshot.version).toBe(2);
  });
}
