import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../helpers/pglite-migrations";
import type { Database } from "@/db/client";
import {
  analysisRuns,
  approvedDiagnoses,
  businessStateSnapshots,
  claimEvidence,
  claims,
  diagnosisCalculationSources,
  diagnosisCalculations,
  diagnosisItemReferences,
  diagnosisItemReviews,
  diagnosisItems,
  diagnosisReviewSessions,
  evidence,
  metrics,
  strategyWorkflows,
  workflowTransitions,
} from "@/db/schema";
import type { Phase1DiagnosisModel } from "@/ai/phase1-diagnosis/model";
import { REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE } from "@/domain/phase1-diagnosis";
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
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { GapResolutionService } from "@/services/gap-resolution-service";
import { RevisionRequiresNewSnapshotError } from "@/services/phase1-diagnosis-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import {
  FakeDiagnosisModel,
  diagnosisService,
  handleOf,
  phase1ReadyBusiness as readyBusiness,
  REVENUE_STATEMENT,
  validDiagnosis,
} from "../fixtures/phase1-diagnosis-fixture";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("Phase 1 Diagnosis application flow (synthetic data only)", () => {
  let client: PGlite;
  let database: Database;
  let foundation: FoundationRepository;

  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    database = drizzle(client) as unknown as Database;
    foundation = new FoundationRepository(database);
  }, 30_000);

  afterAll(async () => client.close());

  const phase1ReadyBusiness = (name: string) => readyBusiness(database, name);
  function service(model: Phase1DiagnosisModel, orchestrator: ReturnType<typeof createStrategyOrchestrator>) {
    return diagnosisService(database, model, orchestrator);
  }

  async function canonicalFingerprint(businessId: string) {
    const [row] = await database.execute<{ value: string }>(sql`
      select md5(
        coalesce((select string_agg(c::text, '|' order by c.id) from claims c where c.business_id = ${businessId}), '-')
        || coalesce((select string_agg(e::text, '|' order by e.id) from evidence e where e.business_id = ${businessId}), '-')
        || coalesce((select string_agg(m::text, '|' order by m.id) from metrics m where m.business_id = ${businessId}), '-')
        || coalesce((select string_agg(r::text, '|' order by r.claim_id, r.evidence_id) from claim_evidence r where r.business_id = ${businessId}), '-')
        || coalesce((select string_agg(s::text, '|' order by s.id) from business_state_snapshots s where s.business_id = ${businessId}), '-')
      ) as value`).then((result) => (result as unknown as { rows: Array<{ value: string }> }).rows);
    return row.value;
  }

  async function workflowState(businessId: string) {
    const [workflow] = await database.select().from(strategyWorkflows).where(eq(strategyWorkflows.businessId, businessId));
    return workflow.state;
  }

  it("runs on the exact snapshot with handles only, then stops at human review without touching canonical state", async () => {
    const fixture = await phase1ReadyBusiness("Diagnosis success");
    const before = await canonicalFingerprint(fixture.business.id);
    const model = new FakeDiagnosisModel(validDiagnosis);
    const result = await service(model, fixture.orchestrator).generate({ businessId: fixture.business.id });

    expect(result.run).toMatchObject({
      status: "SUCCEEDED", module: "phase1_diagnosis", runType: "snapshot_diagnosis",
      inputSnapshotId: fixture.snapshot.id, inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v1",
    });
    expect(result.run.modelConfiguration).toMatchObject({ gapSourceRunId: fixture.coherenceRun.id, snapshotContentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Mandatory human checkpoint: never auto-approved.
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_AWAITING_REVIEW");
    expect(await database.select().from(approvedDiagnoses).where(eq(approvedDiagnoses.businessId, fixture.business.id))).toHaveLength(0);

    const input = model.inputs[0];
    expect(JSON.stringify(input)).not.toMatch(uuid);
    expect(input.validatedGaps.map((gap) => gap.handle)).toEqual(["G001", "G002"]);
    expect(input.calculations).toEqual([expect.objectContaining({
      handle: "D001", derived: true, valueNumeric: "14400.0000", valuePrecision: "approximate", unit: "GBP per year", sourceHandles: ["M001"],
    })]);

    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, result.run.id));
    expect(items.map((item) => item.itemRef).toSorted()).toEqual(["I001", "I002", "I003"]);
    const references = await database.select().from(diagnosisItemReferences).where(eq(diagnosisItemReferences.analysisRunId, result.run.id));
    expect(references.map((reference) => reference.evidenceId).filter(Boolean)).toEqual(expect.arrayContaining([fixture.revenue.id, fixture.profitGap.id]));
    expect(references.some((reference) => reference.evidenceGapId !== null && reference.role === "limiting_gap")).toBe(true);
    const [calculation] = await database.select().from(diagnosisCalculations).where(eq(diagnosisCalculations.analysisRunId, result.run.id));
    expect(references.some((reference) => reference.diagnosisCalculationId === calculation.id)).toBe(true);
    const sources = await database.select().from(diagnosisCalculationSources).where(eq(diagnosisCalculationSources.diagnosisCalculationId, calculation.id));
    expect(sources).toEqual([expect.objectContaining({ metricId: fixture.metric.id, evidenceId: null })]);

    expect(await canonicalFingerprint(fixture.business.id)).toBe(before);
  });

  it("fails closed on an unsupported negative conclusion, leaves the workflow at PHASE1_ANALYSING, and permits a retry", async () => {
    const fixture = await phase1ReadyBusiness("Diagnosis fail closed");
    const before = await canonicalFingerprint(fixture.business.id);
    const invalid = new FakeDiagnosisModel((input) => ({
      items: [...validDiagnosis(input).items, {
        itemType: "risk",
        statement: "The business is unprofitable.",
        rationale: "Profit figures are missing.",
        grounding: "evidence_backed",
        materiality: "high",
        interpretationConfidence: "high",
        limitations: null,
        references: [{ entityType: "evidence", ref: handleOf(input, "Reliable profit figures are unavailable."), role: "primary" }],
      }],
    }));
    await expect(service(invalid, fixture.orchestrator).generate({ businessId: fixture.business.id })).rejects.toThrow("Phase 1 Diagnosis failed");
    const [failed] = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))
      .then((rows) => rows.filter((row) => row.module === "phase1_diagnosis"));
    expect(failed.status).toBe("FAILED");
    expect(JSON.stringify(failed.validationErrors)).toContain("missing data is not evidence of poor performance");
    expect(await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, failed.id))).toHaveLength(0);
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_ANALYSING");

    const uuidModel = new FakeDiagnosisModel((input) => ({
      items: [{ ...validDiagnosis(input).items[0], references: [{ entityType: "evidence", ref: fixture.revenue.id, role: "primary" }] }],
    }));
    await expect(service(uuidModel, fixture.orchestrator).generate({ businessId: fixture.business.id })).rejects.toThrow("Phase 1 Diagnosis failed");
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_ANALYSING");

    const retried = await service(new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator).generate({ businessId: fixture.business.id });
    expect(retried.run.status).toBe("SUCCEEDED");
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_AWAITING_REVIEW");
    expect(await canonicalFingerprint(fixture.business.id)).toBe(before);
  });

  it("requires an explicit decision on every item, applies ACCEPT / CORRECT / REJECT, and approves an immutable server-built artifact", async () => {
    const fixture = await phase1ReadyBusiness("Diagnosis review");
    const before = await canonicalFingerprint(fixture.business.id);
    const model = new FakeDiagnosisModel(validDiagnosis);
    const diagnosis = service(model, fixture.orchestrator);
    const { run } = await diagnosis.generate({ businessId: fixture.business.id });
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id));
    const byRef = new Map(items.map((item) => [item.itemRef, item]));
    const session = await diagnosis.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    const base = { businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" };

    await diagnosis.reviewItem({ ...base, diagnosisItemId: byRef.get("I001")!.id, decision: "ACCEPTED" });
    await expect(diagnosis.approve(base)).rejects.toThrow("Every diagnosis item requires exactly one decision");

    // A correction must pass the same contract as model output.
    const revenueHandle = handleOf(model.inputs[0], "Total revenue was approximately £240,000 in the last 12 months.");
    await expect(diagnosis.reviewItem({
      ...base, diagnosisItemId: byRef.get("I002")!.id, decision: "CORRECTED",
      correctedPayload: { ...validDiagnosis(model.inputs[0]).items[1], grounding: "evidence_backed", references: [{ entityType: "evidence", ref: "E999", role: "primary" }] },
    })).rejects.toThrow("is not in this diagnosis input");
    const corrected = {
      itemType: "constraint",
      statement: "Revenue is approximately £240,000 but profitability is unknown.",
      rationale: "Corrected by the reviewer to pair revenue with the profit gap.",
      grounding: "evidence_backed",
      materiality: "high",
      interpretationConfidence: "low",
      limitations: "Profit remains untracked.",
      references: [
        { entityType: "evidence", ref: revenueHandle, role: "primary" },
        { entityType: "gap", ref: "G001", role: "limiting_gap" },
      ],
    };
    await diagnosis.reviewItem({ ...base, diagnosisItemId: byRef.get("I002")!.id, decision: "CORRECTED", correctedPayload: corrected, reason: "Sharper framing" });
    await diagnosis.reviewItem({ ...base, diagnosisItemId: byRef.get("I003")!.id, decision: "REJECTED", reason: "Run-rate is not the key point" });
    await expect(diagnosis.reviewItem({ ...base, diagnosisItemId: byRef.get("I003")!.id, decision: "ACCEPTED" })).rejects.toThrow("already has a decision");

    const approved = await diagnosis.approve(base);
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_APPROVED");
    expect(approved).toMatchObject({
      analysisRunId: run.id, reviewSessionId: session.id, snapshotId: fixture.snapshot.id, snapshotVersion: fixture.snapshot.version,
      inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v1", inputHash: run.inputHash,
      artifactVersion: "phase1_diagnosis_artifact_v1", version: 1, approvedBy: "Reviewer",
    });
    const content = approved.approvedContent as {
      decisions: Record<string, number>;
      items: Array<Record<string, unknown> & { itemRef: string; references: unknown[] }>;
      excludedItems: unknown[];
      carriedForwardGaps: Array<{ handle: string }>;
      calculations: Array<Record<string, unknown>>;
      semantics: string;
    };
    expect(content.decisions).toEqual({ ACCEPTED: 1, CORRECTED: 1, REJECTED: 1 });
    expect(content.items.map((item: { itemRef: string }) => item.itemRef)).toEqual(["I001", "I002"]);
    expect(content.items[1]).toMatchObject({ decision: "CORRECTED", itemType: "constraint", statement: corrected.statement, grounding: "evidence_backed" });
    expect(content.items[1].references).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "evidence", handle: revenueHandle, id: fixture.revenue.id }),
      expect.objectContaining({ entityType: "gap", handle: "G001" }),
    ]));
    expect(content.excludedItems).toEqual([expect.objectContaining({ itemRef: "I003", decision: "REJECTED" })]);
    expect(content.carriedForwardGaps.map((gap: { handle: string }) => gap.handle)).toEqual(["G001", "G002"]);
    expect(content.calculations[0]).toMatchObject({ handle: "D001", derived: true, sources: [expect.objectContaining({ id: fixture.metric.id, handle: "M001" })] });
    expect(content.semantics).toContain("does not make any Claim true");

    const [approval] = await database.select().from(workflowTransitions)
      .where(eq(workflowTransitions.event, "APPROVE_PHASE1"))
      .then((rows) => rows.filter((row) => row.metadata.approvedDiagnosisId === approved.id));
    expect(approval).toMatchObject({ actorType: "human", actorId: "Reviewer", toState: "PHASE1_APPROVED" });
    expect((await database.select().from(diagnosisReviewSessions).where(eq(diagnosisReviewSessions.id, session.id)))[0].status).toBe("COMPLETED");

    // Immutable history.
    await expect(database.update(approvedDiagnoses).set({ approvedBy: "Someone else" }).where(eq(approvedDiagnoses.id, approved.id))).rejects.toThrow();
    await expect(database.update(diagnosisItems).set({ statement: "Rewritten" }).where(eq(diagnosisItems.analysisRunId, run.id))).rejects.toThrow();
    await expect(database.delete(diagnosisItemReviews).where(eq(diagnosisItemReviews.reviewSessionId, session.id))).rejects.toThrow();
    await expect(database.update(diagnosisReviewSessions).set({ status: "OPEN", completedAt: null }).where(eq(diagnosisReviewSessions.id, session.id))).rejects.toThrow();
    expect(await canonicalFingerprint(fixture.business.id)).toBe(before);
  });

  it("refuses diagnosis without a continuation basis and refuses approval without an artifact", async () => {
    const business = await foundation.createBusiness({ name: "Diagnosis not ready (synthetic test)", profileData: {} });
    await foundation.createSnapshot(business.id);
    const orchestrator = createStrategyOrchestrator(database);
    await expect(service(new FakeDiagnosisModel(validDiagnosis), orchestrator).generate({ businessId: business.id }))
      .rejects.toThrow("Continue with the latest snapshot's known gaps");

    const fixture = await phase1ReadyBusiness("Diagnosis approval precondition");
    await service(new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator).generate({ businessId: fixture.business.id });
    await expect(fixture.orchestrator.transition({
      businessId: fixture.business.id, event: "APPROVE_PHASE1", actorType: "human", actorId: "Reviewer",
      metadata: { approvedDiagnosisId: crypto.randomUUID() },
    })).rejects.toThrow("Approved diagnosis not found");
    await expect(fixture.orchestrator.transition({
      businessId: fixture.business.id, event: "APPROVE_PHASE1", actorType: "system", metadata: {},
    })).rejects.toThrow("requires a human actor");
    expect(await workflowState(fixture.business.id)).toBe("PHASE1_AWAITING_REVIEW");
  });

  it("returns a whole diagnosis for revision without creating an artifact", async () => {
    const fixture = await phase1ReadyBusiness("Diagnosis revision");
    const diagnosis = service(new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    await diagnosis.generate({ businessId: fixture.business.id });
    await diagnosis.requestRevision({ businessId: fixture.business.id, reason: "Needs a fresh look" });
    expect(await workflowState(fixture.business.id)).toBe("REVISION_REQUIRED");
    expect(await database.select({ value: count() }).from(approvedDiagnoses).where(eq(approvedDiagnoses.businessId, fixture.business.id))).toEqual([{ value: 0 }]);
    expect((await database.select().from(claims).where(eq(claims.businessId, fixture.business.id)))).toHaveLength(1);
    expect((await database.select().from(evidence).where(eq(evidence.businessId, fixture.business.id)))).toHaveLength(3);
    expect((await database.select().from(metrics).where(eq(metrics.businessId, fixture.business.id)))).toHaveLength(1);
    expect((await database.select().from(claimEvidence).where(eq(claimEvidence.businessId, fixture.business.id)))).toHaveLength(1);
    expect((await database.select().from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, fixture.business.id)))).toHaveLength(1);
  });

  describe("v1 revision semantics: a revised diagnosis needs a newer snapshot", () => {
    async function transitions(businessId: string) {
      const [workflow] = await database.select().from(strategyWorkflows).where(eq(strategyWorkflows.businessId, businessId));
      return database.select().from(workflowTransitions).where(eq(workflowTransitions.workflowId, workflow.id))
        .then((rows) => rows.toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime()));
    }
    /** Every persisted row of one diagnosis lifecycle, for immutability comparison. */
    async function diagnosisRecord(runId: string, snapshotId: string) {
      const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, runId));
      const sessions = await database.select().from(diagnosisReviewSessions).where(eq(diagnosisReviewSessions.analysisRunId, runId));
      return {
        run: await database.select().from(analysisRuns).where(eq(analysisRuns.id, runId)),
        items,
        references: await database.select().from(diagnosisItemReferences).where(eq(diagnosisItemReferences.analysisRunId, runId)),
        calculations: await database.select().from(diagnosisCalculations).where(eq(diagnosisCalculations.analysisRunId, runId)),
        sessions,
        reviews: sessions.length
          ? await database.select().from(diagnosisItemReviews).where(eq(diagnosisItemReviews.reviewSessionId, sessions[0].id))
          : [],
        snapshot: await database.select().from(businessStateSnapshots).where(eq(businessStateSnapshots.id, snapshotId)),
      };
    }

    it("refuses same-snapshot re-diagnosis, then returns through the normal evidence loop to a fresh diagnosis of a newer snapshot", async () => {
      const fixture = await phase1ReadyBusiness("Diagnosis revision loop");
      const businessId = fixture.business.id;
      const model = new FakeDiagnosisModel(validDiagnosis);
      const diagnosis = service(model, fixture.orchestrator);

      // First diagnosis, reviewed, then sent for revision.
      const { run: first } = await diagnosis.generate({ businessId });
      const firstItems = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, first.id));
      const session = await diagnosis.startReview({ businessId, runId: first.id, reviewerId: "Reviewer" });
      for (const item of firstItems) {
        await diagnosis.reviewItem({ businessId, reviewSessionId: session.id, reviewerId: "Reviewer", diagnosisItemId: item.id, decision: "REJECTED" });
      }
      const beforeRevision = await diagnosisRecord(first.id, fixture.snapshot.id);
      await diagnosis.requestRevision({ businessId, reason: "Interpretation needs new evidence" });
      expect(await workflowState(businessId)).toBe("REVISION_REQUIRED");
      expect((await transitions(businessId)).at(-1)).toMatchObject({
        event: "REQUEST_REVISION", fromState: "PHASE1_AWAITING_REVIEW", toState: "REVISION_REQUIRED", actorType: "human",
      });
      // REQUEST_REVISION leaves the run, items, review session, decisions and snapshot untouched.
      expect(await diagnosisRecord(first.id, fixture.snapshot.id)).toEqual(beforeRevision);

      // Same snapshot: no run, no reuse, no model call, no GENERATE_PHASE1, no state change.
      const canonicalBefore = await canonicalFingerprint(businessId);
      const transitionsBefore = await transitions(businessId);
      const runsBefore = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, businessId));
      await expect(diagnosis.generate({ businessId })).rejects.toBeInstanceOf(RevisionRequiresNewSnapshotError);
      await expect(diagnosis.generate({ businessId })).rejects.toThrow(REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE);
      await expect(fixture.orchestrator.transition({
        businessId, event: "GENERATE_PHASE1", actorType: "human", actorId: "Reviewer",
        metadata: { snapshotId: fixture.snapshot.id, coherenceRunId: fixture.coherenceRun.id },
      })).rejects.toThrow("Invalid workflow transition: REVISION_REQUIRED + GENERATE_PHASE1");
      expect(model.calls).toBe(1);
      expect(await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, businessId))).toEqual(runsBefore);
      expect(await transitions(businessId)).toEqual(transitionsBefore);
      expect(await workflowState(businessId)).toBe("REVISION_REQUIRED");
      expect(await canonicalFingerprint(businessId)).toBe(canonicalBefore);

      // Ordinary Add Information is accepted and enters the normal evidence loop.
      const orchestrator = fixture.orchestrator;
      const reviews = new EvidenceReviewService(new EvidenceReviewRepository(database), orchestrator);
      const rawText = "Costs are now tracked in monthly management accounts.";
      const extraction = new EvidenceExtractionService(new EvidenceExtractionRepository(database), {
        getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
        extract: async () => {
          const output = { claims: [], metrics: [], relationships: [], evidence: [{
            proposalRef: "evidence_1", evidenceType: "management_record", statement: rawText,
            valueNumeric: null, valuePrecision: null, valueLower: null, valueUpper: null, valueText: null, unit: null,
            periodStart: null, periodEnd: null, sourceType: "business_intake", sourceReference: null, sourceMetadata: { suppliedBy: "founder", notes: "Synthetic revision test" },
            reliabilityLevel: "medium", reliabilityScore: 0.6, directnessLevel: "direct", recencyLevel: "current",
            rawPayload: { excerpt: rawText }, materiality: "medium", sourceExcerpt: rawText,
          }] };
          return { output, rawOutput: output };
        },
      });
      const addInformation = new AddInformationService(
        new AddInformationRepository(database),
        new SourceSubmissionService(new SourceSubmissionRepository(database)),
        extraction,
        reviews,
      );
      const added = await addInformation.submit({ businessId, rawText });
      expect(await workflowState(businessId)).toBe("EVIDENCE_PROCESSING");
      expect((await transitions(businessId)).find((row) => row.event === "ADD_EVIDENCE")).toMatchObject({
        fromState: "REVISION_REQUIRED", toState: "EVIDENCE_PROCESSING", actorType: "human",
      });
      // Nothing canonical changes until a human completes Evidence Review.
      expect(await canonicalFingerprint(businessId)).toBe(canonicalBefore);

      const evidenceSession = await reviews.startReview({ businessId, extractionRunId: added.run.id, reviewerId: "Reviewer" });
      for (const proposal of (await reviews.getReview(evidenceSession.id, businessId)).proposals) {
        await reviews.reviewProposal({ businessId, reviewSessionId: evidenceSession.id, reviewerId: "Reviewer", proposalId: proposal.id, decision: "ACCEPTED" });
      }
      const completed = await reviews.completeReview({ businessId, reviewSessionId: evidenceSession.id, reviewerId: "Reviewer" });
      expect(completed.snapshot.version).toBe(fixture.snapshot.version + 1);
      expect(await workflowState(businessId)).toBe("EVIDENCE_READY");
      expect(await database.select().from(evidence).where(eq(evidence.businessId, businessId))).toHaveLength(4);

      // Evidence Coherence on the newer snapshot, then the human gap decision back to PHASE1_READY.
      const coherence = new EvidenceCoherenceRepository(database);
      const coherenceRun = await new EvidenceCoherenceService(coherence, {
        getConfiguration: () => ({ provider: "fake", model: "coherence", metadata: {} }),
        analyse: async () => {
          const output = { contradictions: [], questions: [], gaps: [
            { findingRef: "gap_1", area: "financial_performance", missingInformation: "Profit is still unreported.", decisionImpact: "Profitability cannot be assessed.", materiality: "high", priorityRank: 1, references: [{ entityType: "evidence", ref: "E002", role: "primary" }] },
          ] };
          return { output, rawOutput: output };
        },
      }, orchestrator).analyseCurrentSnapshot({ businessId });
      expect(coherenceRun.run.inputSnapshotId).toBe(completed.snapshot.id);
      expect(await workflowState(businessId)).toBe("GAP_RESOLUTION_REQUIRED");
      await new GapResolutionService(coherence, orchestrator).continueWithGaps({ businessId });
      expect(await workflowState(businessId)).toBe("PHASE1_READY");

      // A fresh diagnosis: a new run bound to the newer snapshot, from PHASE1_READY.
      const canonicalAfterEvidence = await canonicalFingerprint(businessId);
      const second = await diagnosis.generate({ businessId });
      expect(second.reused).toBe(false);
      expect(second.run.id).not.toBe(first.id);
      expect(second.run.inputSnapshotId).toBe(completed.snapshot.id);
      expect(second.run.modelConfiguration.gapSourceRunId).toBe(coherenceRun.run.id);
      expect(model.calls).toBe(2);
      expect(model.inputs[1].snapshot.evidence.map((item) => item.statement)).toContain(rawText);
      expect(await workflowState(businessId)).toBe("PHASE1_AWAITING_REVIEW");
      expect((await transitions(businessId)).filter((row) => row.event === "GENERATE_PHASE1").map((row) => row.fromState))
        .toEqual(["PHASE1_READY", "PHASE1_READY"]);
      // A new review lifecycle; the old diagnosis and its review stay exactly as they were.
      const secondSession = await diagnosis.startReview({ businessId, runId: second.run.id, reviewerId: "Reviewer" });
      expect(secondSession.id).not.toBe(session.id);
      expect(await diagnosisRecord(first.id, fixture.snapshot.id)).toEqual(beforeRevision);
      // Diagnosis itself never changed canonical state; only Evidence Review did.
      expect(await canonicalFingerprint(businessId)).toBe(canonicalAfterEvidence);
      expect(await database.select().from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, businessId))).toHaveLength(2);
    });
  });

  describe("effective reviewed item (M4-13)", () => {
    it("shows the page exactly what approval persists: generated for ACCEPTED, corrected for CORRECTED, nothing for REJECTED", async () => {
      const fixture = await phase1ReadyBusiness("Diagnosis effective item");
      const businessId = fixture.business.id;
      const model = new FakeDiagnosisModel(validDiagnosis);
      const diagnosis = service(model, fixture.orchestrator);
      const { run } = await diagnosis.generate({ businessId });
      const items = (await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id)))
        .toSorted((left, right) => left.itemRef.localeCompare(right.itemRef));
      const session = await diagnosis.startReview({ businessId, runId: run.id, reviewerId: "Reviewer" });
      const base = { businessId, reviewSessionId: session.id, reviewerId: "Reviewer" };
      const input = model.inputs[0];
      // I002 corrected in grounding, confidence, limitations and references.
      const corrected = {
        ...validDiagnosis(input).items[1],
        grounding: "hypothesis",
        interpretationConfidence: "low",
        limitations: "Corrected limitation: cost and profit data are untracked.",
        references: [
          { entityType: "evidence", ref: handleOf(input, REVENUE_STATEMENT), role: "context" },
          { entityType: "gap", ref: "G001", role: "limiting_gap" },
        ],
      };
      await diagnosis.reviewItem({ ...base, diagnosisItemId: items[0].id, decision: "ACCEPTED" });
      await diagnosis.reviewItem({ ...base, diagnosisItemId: items[1].id, decision: "CORRECTED", correctedPayload: corrected, reason: "Tighter limitation" });
      await diagnosis.reviewItem({ ...base, diagnosisItemId: items[2].id, decision: "REJECTED", reason: "Not needed" });

      // Correction revalidation is preserved: an unresolvable reference is still refused.
      const other = await phase1ReadyBusiness("Diagnosis effective item invalid correction");
      const otherDiagnosis = service(new FakeDiagnosisModel(validDiagnosis), other.orchestrator);
      const { run: otherRun } = await otherDiagnosis.generate({ businessId: other.business.id });
      const [otherItem] = (await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, otherRun.id)))
        .toSorted((left, right) => left.itemRef.localeCompare(right.itemRef));
      const otherSession = await otherDiagnosis.startReview({ businessId: other.business.id, runId: otherRun.id, reviewerId: "Reviewer" });
      await expect(otherDiagnosis.reviewItem({
        businessId: other.business.id, reviewSessionId: otherSession.id, reviewerId: "Reviewer", diagnosisItemId: otherItem.id,
        decision: "CORRECTED", correctedPayload: { ...corrected, references: [{ entityType: "gap", ref: "G009", role: "limiting_gap" }] },
      })).rejects.toThrow();

      const view = (await diagnosis.get(businessId))!;
      const [accepted, correctedView, rejected] = view.items;
      expect(accepted.effective).toMatchObject({ statement: items[0].statement, grounding: items[0].grounding, limitations: items[0].limitations });
      expect(correctedView.effective).toMatchObject({
        statement: corrected.statement, grounding: "hypothesis", interpretationConfidence: "low", limitations: corrected.limitations,
        references: [
          { handle: handleOf(input, REVENUE_STATEMENT), entityType: "evidence", role: "context", label: REVENUE_STATEMENT },
          { handle: "G001", entityType: "gap", role: "limiting_gap", label: "Costs and profit are untracked." },
        ],
      });
      // The original generated item is untouched and still available for audit.
      expect(correctedView.grounding).toBe("interpretive");
      expect(correctedView.limitations).toBe(items[1].limitations);
      expect(rejected.effective).toBeNull();

      // Approve, then prove the page's effective items equal the server-built artifact field for field.
      const approved = await diagnosis.approve(base);
      const artifactItems = (approved.approvedContent as { items: Array<Record<string, unknown>> }).items;
      expect(artifactItems.map((entry) => entry.itemRef)).toEqual(["I001", "I002"]);
      for (const [viewItem, artifactItem] of [[accepted, artifactItems[0]], [correctedView, artifactItems[1]]] as const) {
        const { references, ...fields } = viewItem.effective!;
        expect(artifactItem).toMatchObject(fields);
        expect((artifactItem.references as Array<Record<string, unknown>>).map(({ handle, entityType, role, label }) => ({ handle, entityType, role, label })))
          .toEqual(references);
      }
      expect(artifactItems[1]).toMatchObject({ grounding: "hypothesis", limitations: corrected.limitations, interpretationConfidence: "low" });
      expect((approved.approvedContent as { excludedItems: Array<{ itemRef: string }> }).excludedItems.map((entry) => entry.itemRef)).toEqual(["I003"]);
    });
  });

  describe("approval requires at least one surviving item", () => {
    /** Generates a diagnosis and records the given decision per item, in item order. */
    async function reviewed(name: string, decisions: Array<"ACCEPTED" | "CORRECTED" | "REJECTED">) {
      const fixture = await phase1ReadyBusiness(name);
      const model = new FakeDiagnosisModel(validDiagnosis);
      const diagnosis = service(model, fixture.orchestrator);
      const { run } = await diagnosis.generate({ businessId: fixture.business.id });
      const items = (await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id)))
        .toSorted((left, right) => left.itemRef.localeCompare(right.itemRef));
      const session = await diagnosis.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
      const base = { businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" };
      for (const [index, decision] of decisions.entries()) {
        await diagnosis.reviewItem({
          ...base,
          diagnosisItemId: items[index].id,
          decision,
          correctedPayload: decision === "CORRECTED"
            ? { ...validDiagnosis(model.inputs[0]).items[0], statement: "Revenue was approximately £240,000 over the last 12 months." }
            : undefined,
        });
      }
      return { fixture, diagnosis, base, session };
    }

    it("allows approval with one ACCEPTED item and the rest REJECTED", async () => {
      const { fixture, diagnosis, base } = await reviewed("Approve one accepted", ["ACCEPTED", "REJECTED", "REJECTED"]);
      const approved = await diagnosis.approve(base);
      expect((approved.approvedContent as { items: unknown[] }).items).toHaveLength(1);
      expect(await workflowState(fixture.business.id)).toBe("PHASE1_APPROVED");
    });

    it("allows approval with one CORRECTED item and the rest REJECTED", async () => {
      const { fixture, diagnosis, base } = await reviewed("Approve one corrected", ["CORRECTED", "REJECTED", "REJECTED"]);
      const approved = await diagnosis.approve(base);
      expect((approved.approvedContent as { items: Array<{ decision: string }> }).items).toEqual([expect.objectContaining({ decision: "CORRECTED" })]);
      expect(await workflowState(fixture.business.id)).toBe("PHASE1_APPROVED");
    });

    it("refuses an all-REJECTED review: no artifact, no PHASE1_APPROVED, revision still available", async () => {
      const { fixture, diagnosis, base, session } = await reviewed("Refuse all rejected", ["REJECTED", "REJECTED", "REJECTED"]);
      await expect(diagnosis.approve(base)).rejects.toThrow("An all-rejected diagnosis cannot be approved");
      expect(await database.select().from(approvedDiagnoses).where(eq(approvedDiagnoses.businessId, fixture.business.id))).toHaveLength(0);
      expect((await database.select().from(diagnosisReviewSessions).where(eq(diagnosisReviewSessions.id, session.id)))[0].status).toBe("OPEN");
      expect(await workflowState(fixture.business.id)).toBe("PHASE1_AWAITING_REVIEW");
      await expect(fixture.orchestrator.transition({
        businessId: fixture.business.id, event: "APPROVE_PHASE1", actorType: "human", actorId: "Reviewer",
        metadata: { approvedDiagnosisId: crypto.randomUUID() },
      })).rejects.toThrow();
      expect(await database.select().from(workflowTransitions).where(eq(workflowTransitions.event, "APPROVE_PHASE1"))
        .then((rows) => rows.filter((row) => row.metadata.reviewSessionId === session.id))).toHaveLength(0);
      await diagnosis.requestRevision({ businessId: fixture.business.id, reason: "Every item was rejected" });
      expect(await workflowState(fixture.business.id)).toBe("REVISION_REQUIRED");
    });
  });
});
