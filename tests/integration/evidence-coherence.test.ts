import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { EvidenceCoherenceOutput } from "@/ai/evidence-coherence/contracts";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";

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
    await client.waitReady;
    for (const name of [
      "0000_furry_wolf_cub", "0001_evidence_extraction", "0002_evidence_review",
      "0003_business_permanent_delete", "0004_spotty_harpoon", "0005_cloudy_calypso",
    ]) {
      const migration = await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.exec(statement);
      }
    }
    database = drizzle(client) as unknown as Database;
    foundation = new FoundationRepository(database);
  });

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

  function validOutput(fixture: Awaited<ReturnType<typeof readyBusiness>>): EvidenceCoherenceOutput {
    return {
      contradictions: [{
        findingRef: "contradiction_1", area: "marketing_and_acquisition",
        statement: "Acquisition records conflict.", rationale: "The sources attribute customers differently.",
        materiality: "high", priorityRank: 1,
        references: [
          { recordType: "claim", recordId: fixture.claim.id, role: "primary" },
          { recordType: "evidence", recordId: fixture.evidenceItem.id, role: "conflicting" },
        ],
      }],
      gaps: [{
        findingRef: "gap_1", area: "financial_performance",
        missingInformation: "Customer acquisition cost is unknown.",
        decisionImpact: "Acquisition economics cannot be assessed.",
        materiality: "medium", priorityRank: 2,
        references: [{ recordType: "metric", recordId: fixture.metric.id, role: "context" }],
      }],
      questions: [{ findingType: "gap", findingRef: "gap_1", question: "What is current customer acquisition cost?", priorityOrder: 1 }],
    };
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
      return validOutput(fixture);
    });
    const service = new EvidenceCoherenceService(repository, model, fixture.orchestrator);
    const result = await service.analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(result.run.status).toBe("SUCCEEDED");
    expect((await foundation.getWorkflow(fixture.business.id))?.state).toBe("GAP_RESOLUTION_REQUIRED");
    const persisted = await repository.getRunResult(result.run.id, fixture.business.id);
    expect(persisted?.contradictions).toHaveLength(1);
    expect(persisted?.gaps).toHaveLength(1);
    expect(persisted?.questions).toHaveLength(1);
    expect((await database.select({ value: count() }).from(claims).where(eq(claims.businessId, fixture.business.id)))[0].value).toBe(before.claims);
    expect((await database.select({ value: count() }).from(evidence).where(eq(evidence.businessId, fixture.business.id)))[0].value).toBe(before.evidence);
    expect((await database.select({ value: count() }).from(metrics).where(eq(metrics.businessId, fixture.business.id)))[0].value).toBe(before.metrics);
    expect((await database.select({ value: count() }).from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, fixture.business.id)))[0].value).toBe(before.snapshots);
    expect((await repository.getSnapshot(fixture.snapshot.id, fixture.business.id))?.snapshotData).toEqual(before.snapshotData);
  });

  it("reuses a successful equivalent run without a second model call", async () => {
    const fixture = await readyBusiness("Coherence reuse");
    const repository = new EvidenceCoherenceRepository(database);
    const model = new FakeModel(() => validOutput(fixture));
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
      return validOutput(fixture);
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
    const retryModel = new FakeModel(() => validOutput(fixture));
    const retry = await new EvidenceCoherenceService(repository, retryModel, fixture.orchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id });
    expect(retry.run.status).toBe("SUCCEEDED");
    expect(retry.run.id).not.toBe(failed?.id);
  });

  it("fails invalid snapshot references with no partial findings", async () => {
    const fixture = await readyBusiness("Coherence invalid reference");
    const repository = new EvidenceCoherenceRepository(database);
    const output = validOutput(fixture);
    output.gaps[0].references[0].recordId = "99999999-9999-4999-8999-999999999999";
    const service = new EvidenceCoherenceService(repository, new FakeModel(() => output), fixture.orchestrator);
    await expect(service.analyseCurrentSnapshot({ businessId: fixture.business.id })).rejects.toThrow("analysis failed");
    const run = await repository.getLatestRunForSnapshot(fixture.snapshot.id, fixture.business.id);
    expect(run?.status).toBe("FAILED");
    expect((await database.select().from(evidenceGaps).where(eq(evidenceGaps.analysisRunId, run!.id)))).toHaveLength(0);
  });

  it("rolls back every finding when persistence fails after earlier inserts", async () => {
    const fixture = await readyBusiness("Coherence atomic rollback");
    const repository = new EvidenceCoherenceRepository(database);
    const created = await repository.createRun({
      businessId: fixture.business.id,
      inputSnapshotId: fixture.snapshot.id,
      module: "atomic_rollback_test",
      runType: "snapshot_analysis",
      inputProjectionVersion: "evidence_coherence_input_v1",
      inputPayload: { projectionVersion: "evidence_coherence_input_v1", snapshot: {} as never },
      inputHash: "atomic-rollback-hash",
      promptVersion: "evidence_coherence_v1",
      provider: "fake",
      modelIdentifier: "coherence-test",
      modelConfiguration: {},
    });
    const output = validOutput(fixture);
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
      return validOutput(fixture);
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
      new FakeModel(() => validOutput(fixture)),
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
    await expect(new EvidenceCoherenceService(repository, new FakeModel(() => validOutput(fixture)), fixture.orchestrator)
      .analyseCurrentSnapshot({ businessId: fixture.business.id })).rejects.toThrow("archived");
    expect(await database.select().from(analysisRuns).where(eq(analysisRuns.businessId, fixture.business.id))).toHaveLength(0);
  });
});
