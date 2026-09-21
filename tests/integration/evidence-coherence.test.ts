import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import {
  analysisFindingReferences,
  analysisQuestions,
  analysisRuns,
  businessStateSnapshots,
  claims,
  contradictions,
  evidence,
  evidenceGaps,
  metrics,
} from "@/db/schema";
import type { EvidenceCoherenceModel } from "@/ai/evidence-coherence/model";
import type {
  EvidenceCoherenceModelOutput,
  EvidenceCoherenceOutput,
} from "@/ai/evidence-coherence/contracts";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";
import {
  buildEvidenceCoherenceModelInput,
  hashEvidenceCoherenceModelInput,
} from "@/domain/evidence-coherence-projection";
import {
  EVIDENCE_COHERENCE_INPUT_VERSION,
  EVIDENCE_COHERENCE_MODULE,
  EVIDENCE_COHERENCE_RUN_TYPE,
} from "@/domain/evidence-coherence";
import { EVIDENCE_COHERENCE_PROMPT_VERSION } from "@/ai/evidence-coherence/prompt";

class FakeModel implements EvidenceCoherenceModel {
  calls = 0;
  constructor(
    private readonly outputFactory: (input: Parameters<EvidenceCoherenceModel["analyse"]>[0]) => unknown | Promise<unknown>,
  ) {}
  getConfiguration() { return { provider: "fake", model: "coherence-test", metadata: { deterministic: true } }; }
  async analyse(input: Parameters<EvidenceCoherenceModel["analyse"]>[0]) {
    this.calls += 1;
    const output = await this.outputFactory(input);
    return { output, rawOutput: output };
  }
}

describe("Evidence Coherence application flow", () => {
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

  async function readyBusiness(name: string) {
    const business = await foundation.createBusiness({ name, profileData: { market: "Services" } });
    const claim = await foundation.addClaim({
      businessId: business.id, statement: "Most clients come from referrals.",
      claimType: "management_belief", subjectArea: "acquisition",
      confidenceLevel: "medium", sourceType: "test",
    });
    const evidenceItem = await foundation.addEvidence({
      businessId: business.id, evidenceType: "measurement",
      statement: "Website enquiries account for 70% of customers.", valueNumeric: 70,
      unit: "percent", sourceType: "test", reliabilityLevel: "high",
      directnessLevel: "direct", recencyLevel: "current", materiality: "high",
    });
    const metric = await foundation.addMetric({
      businessId: business.id, metricKey: "website_share", metricLabel: "Website customer share",
      numericValue: 70, unit: "percent", sourceEvidenceId: evidenceItem.id,
    });
    await foundation.linkClaimEvidence({ claimId: claim.id, evidenceId: evidenceItem.id, relationshipType: "contradicts" });
    const snapshot = await foundation.createSnapshot(business.id);
    const orchestrator = createStrategyOrchestrator(database);
    for (const [event, actorType] of [
      ["START_INTAKE", "human"], ["SUBMIT_INTAKE", "human"],
      ["PROCESS_EVIDENCE", "system"], ["MARK_ANALYSIS_COMPLETE", "system"],
    ] as const) await orchestrator.transition({ businessId: business.id, event, actorType, actorId: "test" });
    return { business, claim, evidenceItem, metric, snapshot, orchestrator };
  }

  // Each fixture snapshot holds one Claim, Evidence and Metric, so they project as C001, E001 and M001.
  function validOutput(): EvidenceCoherenceModelOutput {
    return {
      contradictions: [{
        findingRef: "contradiction_1", area: "marketing_and_acquisition",
        statement: "Acquisition records conflict.", rationale: "The sources attribute customers differently.",
        materiality: "high", priorityRank: 1,
        references: [
          { entityType: "claim", ref: "C001", role: "primary" },
          { entityType: "evidence", ref: "E001", role: "conflicting" },
        ],
      }],
      gaps: [{
        findingRef: "gap_1", area: "financial_performance",
        missingInformation: "Customer acquisition cost is unknown.",
        decisionImpact: "Acquisition economics cannot be assessed.",
        materiality: "medium", priorityRank: 2,
        references: [{ entityType: "metric", ref: "M001", role: "context" }],
      }],
      questions: [{ findingType: "gap", findingRef: "gap_1", question: "What is current customer acquisition cost?", priorityOrder: 1 }],
    };
  }

  /** The same findings after application-side resolution, as the repository persists them. */
  function canonicalOutput(fixture: Awaited<ReturnType<typeof readyBusiness>>): EvidenceCoherenceOutput {
    const output = validOutput();
    const ids = { claim: fixture.claim.id, evidence: fixture.evidenceItem.id, metric: fixture.metric.id };
    const resolve = (items: EvidenceCoherenceModelOutput["gaps"][number]["references"]) => items.map((item) => ({
      recordType: item.entityType, recordId: ids[item.entityType], role: item.role,
    }));
    return {
      contradictions: output.contradictions.map((item) => ({ ...item, references: resolve(item.references) })),
      gaps: output.gaps.map((item) => ({ ...item, references: resolve(item.references) })),
      questions: output.questions,
    };
  }

  function modelInputFor(fixture: Awaited<ReturnType<typeof readyBusiness>>) {
    return buildEvidenceCoherenceModelInput({
      ...fixture.snapshot,
      snapshotData: fixture.snapshot.snapshotData as Record<string, unknown>,
    }).modelInput;
  }

  it("persists the RUNNING run before the model, then atomically succeeds without canonical mutation", async () => {
    const fixture = await readyBusiness("Coherence success");
    const repository = new EvidenceCoherenceRepository(database);
    const before = {
      claims: (await database.select({ value: count() }).from(claims).where(eq(claims.businessId, fixture.business.id)))[0].value,
      evidence: (await database.select({ value: count() }).from(evidence).where(eq(evidence.businessId, fixture.business.id)))[0].value,
      metrics: (await database.select({ value: count() }).from(metrics).where(eq(metrics.businessId, fixture.business.id)))[0].value,
      snapshots: (await database.select({ value: count() }).from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, fixture.business.id)))[0].value,
      snapshotData: structuredClone(fixture.snapshot.snapshotData),
    };
    const model = new FakeModel(async (input) => {
      const run = await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id);
      expect(run?.status).toBe("RUNNING");
      expect(run?.inputPayload).toEqual(input);
      return validOutput();
    });
    const service = new EvidenceCoherenceService(repository, model, fixture.orchestrator);
    const result = await service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(result.run.status).toBe("SUCCEEDED");
    expect((await foundation.getWorkflow(fixture.business.id))?.state).toBe("GAP_RESOLUTION_REQUIRED");
    const persisted = await repository.getRunResult(result.run.id, fixture.business.id);
    expect(persisted?.contradictions).toHaveLength(1);
    expect(persisted?.gaps).toHaveLength(1);
    expect(persisted?.questions).toHaveLength(1);
    expect(result.run).toMatchObject({
      inputProjectionVersion: "evidence_coherence_input_v3",
      promptVersion: "evidence_coherence_v4",
      inputHash: hashEvidenceCoherenceModelInput(modelInputFor(fixture)),
    });
    // The model saw handles only; the database received canonical UUIDs only.
    const payload = JSON.stringify(result.run.inputPayload);
    for (const id of [fixture.claim.id, fixture.evidenceItem.id, fixture.metric.id, fixture.business.id, fixture.snapshot.id]) {
      expect(payload).not.toContain(id);
    }
    expect(persisted?.contradictions[0].references.map((item) => [item.claimId, item.evidenceId]))
      .toEqual(expect.arrayContaining([[fixture.claim.id, null], [null, fixture.evidenceItem.id]]));
    expect(persisted?.gaps[0].references).toEqual([expect.objectContaining({ metricId: fixture.metric.id, role: "context" })]);
    expect(result.run.structuredOutput).toEqual(canonicalOutput(fixture));
    expect(JSON.stringify(result.run.structuredOutput)).not.toMatch(/"(C|E|M)\d{3}"/);
    expect(result.run.rawModelOutput).toEqual(validOutput());
    expect((await database.select({ value: count() }).from(claims).where(eq(claims.businessId, fixture.business.id)))[0].value).toBe(before.claims);
    expect((await database.select({ value: count() }).from(evidence).where(eq(evidence.businessId, fixture.business.id)))[0].value).toBe(before.evidence);
    expect((await database.select({ value: count() }).from(metrics).where(eq(metrics.businessId, fixture.business.id)))[0].value).toBe(before.metrics);
    expect((await database.select({ value: count() }).from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, fixture.business.id)))[0].value).toBe(before.snapshots);
    expect((await repository.getSnapshot(fixture.snapshot.id, fixture.business.id))?.snapshotData).toEqual(before.snapshotData);
  });

  it("scopes every Evidence Coherence run lookup to its module", async () => {
    const fixture = await readyBusiness("Coherence module scope");
    const repository = new EvidenceCoherenceRepository(database);
    const result = await new EvidenceCoherenceService(
      repository,
      new FakeModel(() => validOutput()),
      fixture.orchestrator,
    ).analyseCurrentSnapshot({ businessId: fixture.business.id });
    const [secondary] = await database.insert(analysisRuns).values({
      businessId: fixture.business.id,
      inputSnapshotId: fixture.snapshot.id,
      module: "phase1_diagnosis_test_only",
      runType: "snapshot_analysis",
      inputProjectionVersion: "test_projection_v1",
      inputPayload: {},
      inputHash: crypto.randomUUID(),
      promptVersion: "test_prompt_v1",
      provider: "fake",
      modelIdentifier: "test-only",
      modelConfiguration: {},
    }).returning();
    expect((await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id))?.id)
      .toBe(result.run.id);
    expect((await repository.getLatestRunForBusiness(fixture.business.id))?.id).toBe(result.run.id);
    expect(await repository.getRun(secondary.id, fixture.business.id)).toBeUndefined();
    expect(await repository.getRunResult(secondary.id, fixture.business.id)).toBeUndefined();
  });

  it("terminally fails an abandoned equivalent run and retries without rewriting it", async () => {
    vi.stubEnv("AI_RUN_STALE_AFTER_MS", "1");
    try {
      const fixture = await readyBusiness("Coherence stale recovery");
      const repository = new EvidenceCoherenceRepository(database);
      const modelInput = modelInputFor(fixture);
      const abandoned = await repository.createRun({
        businessId: fixture.business.id,
        inputSnapshotId: fixture.snapshot.id,
        module: EVIDENCE_COHERENCE_MODULE,
        runType: EVIDENCE_COHERENCE_RUN_TYPE,
        inputProjectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
        inputPayload: modelInput,
        inputHash: hashEvidenceCoherenceModelInput(modelInput),
        promptVersion: EVIDENCE_COHERENCE_PROMPT_VERSION,
        provider: "fake",
        modelIdentifier: "abandoned",
        modelConfiguration: {},
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const retried = await new EvidenceCoherenceService(
        repository,
        new FakeModel(() => validOutput()),
        fixture.orchestrator,
      ).analyseCurrentSnapshot({ businessId: fixture.business.id });
      const [historical] = await database.select().from(analysisRuns)
        .where(eq(analysisRuns.id, abandoned.run.id));
      expect(historical).toMatchObject({ status: "FAILED", modelIdentifier: "abandoned" });
      expect(historical.validationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "stale_run_recovered" }),
      ]));
      expect(retried.run.id).not.toBe(abandoned.run.id);
      expect(retried.run.status).toBe("SUCCEEDED");
      expect(await repository.failStaleRun({
        runId: retried.run.id,
        businessId: fixture.business.id,
        staleBefore: new Date(Date.now() + 60_000),
        validationErrors: [],
      })).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects recovery of a current run and terminally records reconciliation failure", async () => {
    const fixture = await readyBusiness("Coherence reconciliation recovery");
    const repository = new EvidenceCoherenceRepository(database);
    const modelInput = modelInputFor(fixture);
    const created = await repository.createRun({
      businessId: fixture.business.id,
      inputSnapshotId: fixture.snapshot.id,
      module: EVIDENCE_COHERENCE_MODULE,
      runType: EVIDENCE_COHERENCE_RUN_TYPE,
      inputProjectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
      inputPayload: modelInput,
      inputHash: hashEvidenceCoherenceModelInput(modelInput),
      promptVersion: EVIDENCE_COHERENCE_PROMPT_VERSION,
      provider: "fake",
      modelIdentifier: "current",
      modelConfiguration: {},
    });
    expect(await repository.failStaleRun({
      runId: created.run.id,
      businessId: fixture.business.id,
      staleBefore: new Date(0),
      validationErrors: [],
    })).toBeUndefined();

    // Make this run terminal so a fresh service request can create its own run.
    await repository.failRun({
      runId: created.run.id,
      businessId: fixture.business.id,
      rawModelOutput: null,
      validationErrors: [{ code: "test_cleanup" }],
    });
    const model = new FakeModel(() => validOutput());
    const failingOrchestrator = {
      transition: async () => { throw new Error("forced workflow reconciliation failure"); },
    } as unknown as typeof fixture.orchestrator;
    await expect(new EvidenceCoherenceService(repository, model, failingOrchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id }))
      .rejects.toThrow("Evidence Coherence analysis failed");
    expect(model.calls).toBe(0);
    expect((await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id)))
      .toMatchObject({ status: "FAILED" });
  });

  it("reuses a successful equivalent run without a second model call", async () => {
    const fixture = await readyBusiness("Coherence reuse");
    const repository = new EvidenceCoherenceRepository(database);
    const model = new FakeModel(() => validOutput());
    const service = new EvidenceCoherenceService(repository, model, fixture.orchestrator);
    const first = await service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    const second = await service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(second.run.id).toBe(first.run.id);
    expect(second.reused).toBe(true);
    expect(model.calls).toBe(1);
  });

  it("reuses the single RUNNING run when equivalent requests overlap", async () => {
    const fixture = await readyBusiness("Coherence concurrent reuse");
    const repository = new EvidenceCoherenceRepository(database);
    let releaseModel!: () => void;
    let signalModelStarted!: () => void;
    const modelStarted = new Promise<void>((resolve) => { signalModelStarted = resolve; });
    const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
    const model = new FakeModel(async () => {
      signalModelStarted();
      await modelGate;
      return validOutput();
    });
    const service = new EvidenceCoherenceService(repository, model, fixture.orchestrator);

    const firstRequest = service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    await modelStarted;
    const overlapping = await service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(overlapping.reused).toBe(true);
    expect(overlapping.run.status).toBe("RUNNING");
    expect(model.calls).toBe(1);

    releaseModel();
    const completed = await firstRequest;
    expect(completed.run.id).toBe(overlapping.run.id);
    expect(completed.run.status).toBe("SUCCEEDED");
  });

  it("persists provider/validation failure without findings and permits retry", async () => {
    const fixture = await readyBusiness("Coherence retry");
    const repository = new EvidenceCoherenceRepository(database);
    const failing = new EvidenceCoherenceService(repository, new FakeModel(() => { throw new Error("provider unavailable"); }), fixture.orchestrator);
    await expect(failing.analyseCurrentSnapshot({ businessId: fixture.business.id })).rejects.toThrow("analysis failed");
    const failed = await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id);
    expect(failed?.status).toBe("FAILED");
    expect((await database.select().from(contradictions).where(eq(contradictions.analysisRunId, failed!.id)))).toHaveLength(0);
    const retryModel = new FakeModel(() => validOutput());
    const retry = await new EvidenceCoherenceService(repository, retryModel, fixture.orchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(retry.run.status).toBe("SUCCEEDED");
    expect(retry.run.id).not.toBe(failed?.id);
  });

  it("fails invalid snapshot references closed, persisting no finding of any kind", async () => {
    const fixture = await readyBusiness("Coherence invalid reference");
    const repository = new EvidenceCoherenceRepository(database);
    const cases: Array<{ entityType: "claim" | "evidence" | "metric"; ref: string; error: string }> = [
      { entityType: "metric", ref: "M999", error: "reference metric:M999 is not in the analysed snapshot" },
      // A model that reproduces a real canonical UUID is still rejected under evidence_coherence_v4.
      { entityType: "evidence", ref: fixture.evidenceItem.id, error: "Invalid string" },
      { entityType: "claim", ref: "E001", error: "reference claim:E001 uses a handle outside the declared entity type's namespace" },
    ];
    for (const invalid of cases) {
      const output = validOutput();
      output.gaps[0].references[0] = { entityType: invalid.entityType, ref: invalid.ref, role: "context" };
      const service = new EvidenceCoherenceService(repository, new FakeModel(() => output), fixture.orchestrator);
      await expect(service.analyseCurrentSnapshot({ businessId: fixture.business.id })).rejects.toThrow("analysis failed");
      const run = await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id);
      expect(run).toMatchObject({ status: "FAILED", structuredOutput: null, rawModelOutput: output });
      expect(JSON.stringify(run?.validationErrors)).toContain(invalid.error);
    }
    // The valid contradiction in each output was discarded with the invalid gap.
    for (const table of [contradictions, evidenceGaps, analysisFindingReferences, analysisQuestions]) {
      expect(await database.select().from(table).where(eq(table.businessId, fixture.business.id))).toHaveLength(0);
    }
    expect((await foundation.getWorkflow(fixture.business.id))?.state).toBe("GAP_ANALYSIS");
  });

  it("rolls back every finding when persistence fails after earlier inserts", async () => {
    const fixture = await readyBusiness("Coherence atomic rollback");
    const repository = new EvidenceCoherenceRepository(database);
    const created = await repository.createRun({
      businessId: fixture.business.id,
      inputSnapshotId: fixture.snapshot.id,
      module: "evidence_coherence",
      runType: "snapshot_analysis",
      inputProjectionVersion: "evidence_coherence_input_v1",
      inputPayload: { projectionVersion: "evidence_coherence_input_v1", snapshot: {} as never },
      inputHash: "atomic-rollback-hash",
      promptVersion: "evidence_coherence_v1",
      provider: "fake",
      modelIdentifier: "coherence-test",
      modelConfiguration: {},
    });
    const output = canonicalOutput(fixture);
    output.questions[0].findingRef = "missing_gap";

    await expect(repository.completeRun({
      runId: created.run.id,
      businessId: fixture.business.id,
      rawModelOutput: output,
      output,
    })).rejects.toThrow();

    expect(await database.select().from(contradictions).where(eq(contradictions.analysisRunId, created.run.id))).toHaveLength(0);
    expect(await database.select().from(evidenceGaps).where(eq(evidenceGaps.analysisRunId, created.run.id))).toHaveLength(0);
    expect(await database.select().from(analysisFindingReferences).where(eq(analysisFindingReferences.businessId, fixture.business.id))).toHaveLength(0);
    expect(await database.select().from(analysisQuestions).where(eq(analysisQuestions.businessId, fixture.business.id))).toHaveLength(0);
    expect((await repository.getRun(created.run.id, fixture.business.id))?.status).toBe("RUNNING");
  });

  it("keeps a late historical result but does not advance workflow for a newer snapshot", async () => {
    const fixture = await readyBusiness("Coherence stale run");
    const repository = new EvidenceCoherenceRepository(database);
    const model = new FakeModel(async () => {
      await foundation.addClaim({ businessId: fixture.business.id, statement: "Later live claim", claimType: "observation", subjectArea: "market", confidenceLevel: "low", sourceType: "test" });
      await foundation.createSnapshot(fixture.business.id);
      return validOutput();
    });
    const result = await new EvidenceCoherenceService(repository, model, fixture.orchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(result.run.status).toBe("SUCCEEDED");
    expect((await foundation.getWorkflow(fixture.business.id))?.state).toBe("GAP_ANALYSIS");
    expect((await repository.getLatestSnapshot(fixture.business.id))?.version).toBe(2);
    expect(result.run.inputSnapshotId).toBe(fixture.snapshot.id);

    const historical = await repository.getRunResult(result.run.id, fixture.business.id);
    const latestSnapshot = await repository.getLatestSnapshot(fixture.business.id);
    const currentResult = await new EvidenceCoherenceService(
      repository,
      new FakeModel(() => validOutput()),
      fixture.orchestrator,
    ).analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(currentResult.run.inputSnapshotId).toBe(latestSnapshot?.id);
    expect(currentResult.run.id).not.toBe(result.run.id);
    expect((await foundation.getWorkflow(fixture.business.id))?.state).toBe("GAP_RESOLUTION_REQUIRED");
    expect(await repository.getRunResult(result.run.id, fixture.business.id)).toEqual(historical);
  });

  it("rejects archived Businesses before creating a run", async () => {
    const fixture = await readyBusiness("Coherence archived");
    await foundation.archiveBusiness(fixture.business.id);
    const repository = new EvidenceCoherenceRepository(database);
    await expect(new EvidenceCoherenceService(repository, new FakeModel(() => validOutput()), fixture.orchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id })).rejects.toThrow("archived");
    expect(await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))).toHaveLength(0);
  });
});
