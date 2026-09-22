import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../helpers/pglite-migrations";
import type { Database } from "@/db/client";
import {
  analysisRuns,
  approvedDiagnoses,
  approvedDiagnosisHeadlines,
  approvedDiagnosisHeadlineSets,
  diagnosisHeadlineProposals,
  diagnosisHeadlineReviews,
  diagnosisHeadlineReviewSessions,
  diagnosisItems,
  strategyWorkflows,
  workflowTransitions,
} from "@/db/schema";
import type { DiagnosisHeadlineModel } from "@/ai/diagnosis-headlines/model";
import type { DiagnosisHeadlineModelInput } from "@/ai/diagnosis-headlines/contracts";
import { DIAGNOSIS_HEADLINES_PROMPT_VERSION } from "@/ai/diagnosis-headlines/prompt";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { DiagnosisHeadlineRepository } from "@/repositories/diagnosis-headline-repository";
import {
  DiagnosisHeadlineService,
  HEADLINE_RETRY_REQUIRES_APPROVAL_MESSAGE,
} from "@/services/diagnosis-headline-service";
import { Phase1DiagnosisRepository } from "@/repositories/phase1-diagnosis-repository";
import { Phase1DiagnosisService } from "@/services/phase1-diagnosis-service";
import {
  FakeDiagnosisModel,
  diagnosisModelV2,
  diagnosisService,
  phase1ReadyBusiness as readyBusiness,
  validDiagnosis,
} from "../fixtures/phase1-diagnosis-fixture";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Synthetic headlines only: one short label per approved statement. */
const labels: Record<string, string> = {
  I001: "Revenue is approximately £240,000 a year",
  I002: "Profitability cannot yet be established",
  I003: "Recurring revenue adds a steady base",
};

class FakeHeadlineModel implements DiagnosisHeadlineModel {
  calls = 0;
  inputs: DiagnosisHeadlineModelInput[] = [];
  constructor(private readonly factory: (input: DiagnosisHeadlineModelInput) => unknown = defaultHeadlines) {}
  getConfiguration() {
    return {
      provider: "fake", model: "headline-test",
      promptVersion: DIAGNOSIS_HEADLINES_PROMPT_VERSION, metadata: { deterministic: true },
    };
  }
  async propose(input: DiagnosisHeadlineModelInput) {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    const output = this.factory(input);
    return { output, rawOutput: output };
  }
}

function defaultHeadlines(input: DiagnosisHeadlineModelInput) {
  return { headlines: input.items.map((item) => ({ itemHandle: item.itemHandle, headline: labels[item.itemHandle] })) };
}

describe("Companion diagnosis headlines (synthetic data only)", () => {
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

  const headlineService = (model: DiagnosisHeadlineModel = new FakeHeadlineModel()) =>
    new DiagnosisHeadlineService(new DiagnosisHeadlineRepository(database), model);

  async function md5(query: ReturnType<typeof sql>) {
    const result = await database.execute<{ value: string }>(query);
    return (result as unknown as { rows: Array<{ value: string }> }).rows[0].value;
  }

  const approvedFingerprint = (businessId: string) => md5(sql`
    select md5(coalesce((select string_agg(a::text, '|' order by a.id) from approved_diagnoses a where a.business_id = ${businessId}), '-')
      || coalesce((select string_agg(i::text, '|' order by i.item_ref) from diagnosis_items i where i.business_id = ${businessId}), '-')) as value`);

  async function workflowRow(businessId: string) {
    const [workflow] = await database.select().from(strategyWorkflows).where(eq(strategyWorkflows.businessId, businessId));
    const [transitions] = await database.select({ value: count() }).from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, workflow.id));
    return { state: workflow.state, version: workflow.version, transitions: transitions.value };
  }

  /** A synthetic Business with an approved v1 Phase 1 Diagnosis. */
  async function approvedBusiness(name: string, options: { reject?: string } = {}) {
    const fixture = await readyBusiness(database, name);
    const service = diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id));
    for (const item of items.toSorted((left, right) => left.itemRef.localeCompare(right.itemRef))) {
      await service.reviewItem({
        businessId: fixture.business.id,
        reviewSessionId: session.id,
        reviewerId: "Reviewer",
        diagnosisItemId: item.id,
        decision: options.reject === item.itemRef ? "REJECTED" : "ACCEPTED",
        ...(options.reject === item.itemRef ? { reason: "Not supported by the snapshot" } : {}),
      });
    }
    const approved = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    return { ...fixture, run, approved, items, phase1: service };
  }

  /** Accepts every proposed headline except the named items, which are corrected. */
  async function decideAll(service: DiagnosisHeadlineService, businessId: string, sessionId: string, corrections: Record<string, string> = {}) {
    const proposals = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.businessId, businessId));
    for (const proposal of proposals) {
      const corrected = corrections[proposal.itemRef];
      await service.reviewHeadline({
        businessId,
        reviewSessionId: sessionId,
        reviewerId: "Reviewer",
        diagnosisItemId: proposal.diagnosisItemId,
        decision: corrected ? "CORRECTED" : "ACCEPTED",
        ...(corrected ? { correctedHeadline: corrected, reason: "Clearer for the owner" } : {}),
      });
    }
  }

  it("proposes headlines in its own module from the approved statements alone, changing nothing", async () => {
    const fixture = await approvedBusiness("Headlines propose");
    const before = await approvedFingerprint(fixture.business.id);
    const beforeWorkflow = await workflowRow(fixture.business.id);
    const model = new FakeHeadlineModel();
    const { run } = await headlineService(model).propose({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id,
    });

    expect(run).toMatchObject({
      module: "diagnosis_headlines", runType: "approved_diagnosis_headlines", status: "SUCCEEDED",
      inputProjectionVersion: "diagnosis_headlines_input_v1", promptVersion: "diagnosis_headlines_v1",
      inputSnapshotId: fixture.snapshot.id,
    });
    expect(run.modelConfiguration).toMatchObject({
      approvedDiagnosisId: fixture.approved.id,
      approvedDiagnosisVersion: fixture.approved.version,
      diagnosisRunId: fixture.run.id,
    });
    // The model sees only the approved statements it must label: no canonical record, no UUID.
    const input = model.inputs[0];
    expect(input.items.map((item) => item.itemHandle)).toEqual(["I001", "I002", "I003"]);
    expect(Object.keys(input.items[0])).toEqual(["itemHandle", "itemType", "statement"]);
    expect(JSON.stringify(input)).not.toMatch(uuid);

    const proposals = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.analysisRunId, run.id));
    expect(proposals.map((proposal) => proposal.itemRef).toSorted()).toEqual(["I001", "I002", "I003"]);
    expect(proposals.every((proposal) => proposal.approvedDiagnosisId === fixture.approved.id
      && proposal.diagnosisRunId === fixture.run.id)).toBe(true);
    // The Phase 1 Diagnosis module cannot see this run, and nothing else moved.
    expect(await new Phase1DiagnosisRepository(database).getRun(run.id, fixture.business.id)).toBeUndefined();
    expect(await approvedFingerprint(fixture.business.id)).toBe(before);
    expect(await workflowRow(fixture.business.id)).toEqual(beforeWorkflow);
  });

  it("fails closed on malformed output, creates no review session, and allows only one approved retry", async () => {
    const fixture = await approvedBusiness("Headlines fail closed");
    const invalid = new FakeHeadlineModel((input) => ({
      headlines: input.items.slice(1).map((item) => ({ itemHandle: item.itemHandle, headline: labels[item.itemHandle] })),
    }));
    const service = headlineService(invalid);
    await expect(service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id }))
      .rejects.toThrow("Diagnosis headline proposal failed");
    const [failed] = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))
      .then((rows) => rows.filter((row) => row.module === "diagnosis_headlines"));
    expect(failed.status).toBe("FAILED");
    expect(JSON.stringify(failed.validationErrors)).toContain("has no proposed headline");
    expect(await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.businessId, fixture.business.id))).toHaveLength(0);
    expect(await database.select().from(diagnosisHeadlineReviewSessions)
      .where(eq(diagnosisHeadlineReviewSessions.businessId, fixture.business.id))).toHaveLength(0);

    // A failed run is never silently replaced.
    await expect(headlineService().propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id }))
      .rejects.toThrow(HEADLINE_RETRY_REQUIRES_APPROVAL_MESSAGE);
    // One retry, explicitly approved, is allowed.
    const retried = await headlineService().propose({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, retryOfFailedRunId: failed.id,
    });
    expect(retried.run.status).toBe("SUCCEEDED");
    expect(retried.run.modelConfiguration.retryOfFailedRunId).toBe(failed.id);
  });

  it("refuses a second retry after two failures", async () => {
    const fixture = await approvedBusiness("Headlines retry limit");
    const invalid = new FakeHeadlineModel(() => ({ headlines: [{ itemHandle: "I009", headline: "Unknown item" }] }));
    await expect(headlineService(invalid).propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id }))
      .rejects.toThrow();
    const [first] = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))
      .then((rows) => rows.filter((row) => row.module === "diagnosis_headlines"));
    await expect(headlineService(invalid).propose({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, retryOfFailedRunId: first.id,
    })).rejects.toThrow();
    const runs = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))
      .then((rows) => rows.filter((row) => row.module === "diagnosis_headlines"));
    expect(runs.filter((run) => run.status === "FAILED")).toHaveLength(2);
    await expect(headlineService().propose({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, retryOfFailedRunId: runs[0].id,
    })).rejects.toThrow(HEADLINE_RETRY_REQUIRES_APPROVAL_MESSAGE);
  });

  it("requires every headline to be decided, then approves an immutable set without any workflow change", async () => {
    const fixture = await approvedBusiness("Headlines approval");
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const session = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    expect(session).toMatchObject({ status: "OPEN", setVersion: 1, diagnosisRunId: fixture.run.id });

    const before = await approvedFingerprint(fixture.business.id);
    const beforeWorkflow = await workflowRow(fixture.business.id);
    await expect(service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" }))
      .rejects.toThrow("Every headline requires exactly one decision");

    await decideAll(service, fixture.business.id, session.id, { I002: "Profitability is still unproven" });
    const headlineSet = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    expect(headlineSet).toMatchObject({
      version: 1, approvedBy: "Reviewer", approvedDiagnosisId: fixture.approved.id,
      approvedDiagnosisVersion: fixture.approved.version, diagnosisRunId: fixture.run.id,
    });
    const headlines = await database.select().from(approvedDiagnosisHeadlines)
      .where(eq(approvedDiagnosisHeadlines.headlineSetId, headlineSet.id));
    expect(headlines.map((headline) => [headline.itemRef, headline.headline]).toSorted()).toEqual([
      ["I001", labels.I001],
      ["I002", "Profitability is still unproven"],
      ["I003", labels.I003],
    ]);
    const [completed] = await database.select().from(diagnosisHeadlineReviewSessions)
      .where(eq(diagnosisHeadlineReviewSessions.id, session.id));
    expect(completed.status).toBe("COMPLETED");

    // The approved diagnosis, its items and the workflow are untouched.
    expect(await approvedFingerprint(fixture.business.id)).toBe(before);
    expect(await workflowRow(fixture.business.id)).toEqual(beforeWorkflow);
    // The set and its headlines are immutable (the database trigger refuses the write).
    const refusal = async (write: Promise<unknown>) => {
      const error = await write.then(() => undefined, (caught: unknown) => caught);
      expect(String((error as { cause?: Error }).cause?.message ?? (error as Error).message)).toContain("immutable");
    };
    await refusal(database.update(approvedDiagnosisHeadlineSets).set({ approvedBy: "Someone else" })
      .where(eq(approvedDiagnosisHeadlineSets.id, headlineSet.id)));
    await refusal(database.update(approvedDiagnosisHeadlines).set({ headline: "Rewritten" })
      .where(eq(approvedDiagnosisHeadlines.id, headlines[0].id)));
    await refusal(database.update(diagnosisHeadlineReviews).set({ correctedHeadline: "Rewritten" })
      .where(eq(diagnosisHeadlineReviews.reviewSessionId, session.id)));

    // The approved diagnosis now reads with its companion headlines.
    const view = await new Phase1DiagnosisService(new Phase1DiagnosisRepository(database), new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator)
      .get(fixture.business.id);
    expect(view!.headlines).toMatchObject({ source: "companion", setVersion: 1 });
    expect(view!.headlines.byItemRef.I002).toBe("Profitability is still unproven");
  });

  it("appends a new version rather than changing an approved set, and keeps earlier versions", async () => {
    const fixture = await approvedBusiness("Headlines versioning");
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const first = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    await decideAll(service, fixture.business.id, first.id);
    const firstSet = await service.approve({ businessId: fixture.business.id, reviewSessionId: first.id, reviewerId: "Reviewer" });

    const second = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    expect(second.setVersion).toBe(2);
    await decideAll(service, fixture.business.id, second.id, { I001: "Revenue is about a quarter of a million a year" });
    const secondSet = await service.approve({ businessId: fixture.business.id, reviewSessionId: second.id, reviewerId: "Reviewer" });
    expect(secondSet.version).toBe(2);

    const sets = await database.select().from(approvedDiagnosisHeadlineSets)
      .where(eq(approvedDiagnosisHeadlineSets.approvedDiagnosisId, fixture.approved.id));
    expect(sets.map((set) => set.version).toSorted()).toEqual([1, 2]);
    const kept = await database.select().from(approvedDiagnosisHeadlines)
      .where(eq(approvedDiagnosisHeadlines.headlineSetId, firstSet.id));
    expect(kept.find((headline) => headline.itemRef === "I001")!.headline).toBe(labels.I001);
    const current = await new DiagnosisHeadlineRepository(database).getLatestApprovedSet(fixture.approved.id, fixture.business.id);
    expect(current!.version).toBe(2);
    expect(current!.headlines.find((headline) => headline.itemRef === "I001")!.headline)
      .toBe("Revenue is about a quarter of a million a year");
  });

  it("never labels a rejected item, and refuses an archived Business", async () => {
    const fixture = await approvedBusiness("Headlines rejected item", { reject: "I003" });
    const model = new FakeHeadlineModel();
    const service = headlineService(model);
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    expect(model.inputs[0].items.map((item) => item.itemHandle)).toEqual(["I001", "I002"]);
    const proposals = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.analysisRunId, run.id));
    expect(proposals.map((proposal) => proposal.itemRef).toSorted()).toEqual(["I001", "I002"]);

    await foundation.archiveBusiness(fixture.business.id);
    await expect(service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    })).rejects.toThrow();
    await expect(headlineService().propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id }))
      .rejects.toThrow();
  });

  it("rejects a corrected headline that adds a number the approved statement does not carry", async () => {
    const fixture = await approvedBusiness("Headlines correction rules");
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const session = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    const [proposal] = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.analysisRunId, run.id))
      .then((rows) => rows.filter((row) => row.itemRef === "I001"));
    await expect(service.reviewHeadline({
      businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer",
      diagnosisItemId: proposal.diagnosisItemId, decision: "CORRECTED", correctedHeadline: "Revenue grew 30% to £240,000",
    })).rejects.toThrow(/introduces the number 30/);
    expect(await database.select().from(diagnosisHeadlineReviews)
      .where(eq(diagnosisHeadlineReviews.reviewSessionId, session.id))).toHaveLength(0);
  });

  it("runs a v2 diagnosis end to end: a headline is generated, reviewed and carried into artifact v2", async () => {
    const fixture = await readyBusiness(database, "Diagnosis v2 headline");
    const service = diagnosisService(database, diagnosisModelV2(), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    expect(run.promptVersion).toBe("phase1_diagnosis_v2");
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id))
      .then((rows) => rows.toSorted((left, right) => left.itemRef.localeCompare(right.itemRef)));
    expect(items.map((item) => item.headline)).toEqual([
      "Revenue is approximately £240,000 a year",
      "Profitability cannot yet be established",
      "Recurring revenue runs at approximately £14,400 a year",
    ]);

    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    for (const item of items) {
      const corrected = item.itemRef === "I002";
      await service.reviewItem({
        businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer",
        diagnosisItemId: item.id, decision: corrected ? "CORRECTED" : "ACCEPTED",
        ...(corrected ? {
          reason: "A clearer label",
          correctedPayload: {
            headline: "Profitability is still unproven",
            itemType: item.itemType, statement: item.statement, rationale: item.rationale,
            grounding: item.grounding, materiality: item.materiality,
            interpretationConfidence: item.interpretationConfidence, limitations: item.limitations,
            references: [
              { entityType: "evidence", ref: "E002", role: "context" },
              { entityType: "gap", ref: "G001", role: "limiting_gap" },
            ],
          },
        } : {}),
      });
    }
    const approved = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    expect(approved.artifactVersion).toBe("phase1_diagnosis_artifact_v2");
    const content = approved.approvedContent as { items: Array<{ itemRef: string; headline: string }> };
    expect(content.items.map((item) => [item.itemRef, item.headline])).toEqual([
      ["I001", "Revenue is approximately £240,000 a year"],
      ["I002", "Profitability is still unproven"],
      ["I003", "Recurring revenue runs at approximately £14,400 a year"],
    ]);
    // The original AI headline stays on the immutable item for audit.
    expect(items[1].headline).toBe("Profitability cannot yet be established");

    const view = await new Phase1DiagnosisService(new Phase1DiagnosisRepository(database), diagnosisModelV2(), fixture.orchestrator)
      .get(fixture.business.id);
    expect(view!.headlines).toMatchObject({ source: "native" });
    expect(view!.headlines.byItemRef.I002).toBe("Profitability is still unproven");
    // A v2 diagnosis needs no companion set.
    await expect(headlineService().propose({ businessId: fixture.business.id, approvedDiagnosisId: approved.id }))
      .rejects.toThrow(/already carries reviewed headlines/);
  });

  it("refuses a v2 run whose output omits a headline, and writes no diagnosis item", async () => {
    const fixture = await readyBusiness(database, "Diagnosis v2 missing headline");
    const model = diagnosisModelV2((input) => ({
      items: [{ ...validDiagnosis(input).items[0] }],
    }));
    const service = diagnosisService(database, model, fixture.orchestrator);
    await expect(service.generate({ businessId: fixture.business.id })).rejects.toThrow("Phase 1 Diagnosis failed");
    const [failed] = await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))
      .then((rows) => rows.filter((row) => row.module === "phase1_diagnosis"));
    expect(failed.status).toBe("FAILED");
    expect(await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, failed.id))).toHaveLength(0);
  });

  it("keeps an approved v1 diagnosis readable and unchanged now that v2 exists", async () => {
    const fixture = await approvedBusiness("v1 still readable");
    const [approved] = await database.select().from(approvedDiagnoses)
      .where(eq(approvedDiagnoses.businessId, fixture.business.id));
    expect(approved.artifactVersion).toBe("phase1_diagnosis_artifact_v1");
    expect(JSON.stringify(approved.approvedContent)).not.toContain("headline");
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.businessId, fixture.business.id));
    expect(items.every((item) => item.headline === null)).toBe(true);
    const view = await new Phase1DiagnosisService(new Phase1DiagnosisRepository(database), new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator)
      .get(fixture.business.id);
    expect(view!.items.every((item) => item.headline === null)).toBe(true);
    expect(view!.headlines).toEqual({ source: "none", byItemRef: {} });
  });
});
