import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import {
  analysisFindingReferences,
  analysisQuestionSources,
  analysisQuestions,
  analysisRuns,
  contradictions,
  evidenceGaps,
} from "@/db/schema";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";
import {
  buildEvidenceCoherenceProjection,
  evidenceCoherenceModelInput,
  hashEvidenceCoherenceProjection,
} from "@/domain/evidence-coherence-projection";
import {
  EVIDENCE_COHERENCE_INPUT_VERSION,
  EVIDENCE_COHERENCE_MODULE,
  EVIDENCE_COHERENCE_RUN_TYPE,
} from "@/domain/evidence-coherence";
import { EVIDENCE_COHERENCE_PROMPT_VERSION } from "@/ai/evidence-coherence/prompt";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

describe("real PostgreSQL 17 Evidence Coherence integrity", () => {
  let pool: Pool;
  let database: Database;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
  });

  afterAll(async () => pool.end());

  async function rejectAtSavepoint(client: PoolClient, action: () => Promise<unknown>) {
    const name = `sp_${randomUUID().replaceAll("-", "")}`;
    await client.query(`savepoint ${name}`);
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    await client.query(`rollback to savepoint ${name}`);
    await client.query(`release savepoint ${name}`);
    expect(rejected).toBe(true);
  }

  async function seed(client: PoolClient, label: string) {
    const businessId = randomUUID();
    const snapshotId = randomUUID();
    const claimId = randomUUID();
    const evidenceId = randomUUID();
    const metricId = randomUUID();
    const sourceId = randomUUID();
    await client.query("insert into businesses (id,name) values ($1,$2)", [businessId, label]);
    await client.query("insert into business_state_snapshots (id,business_id,version,snapshot_data) values ($1,$2,1,'{}')", [snapshotId, businessId]);
    await client.query("insert into claims (id,business_id,statement,claim_type,subject_area,confidence_level,confidence_basis,source_type) values ($1,$2,'Claim','observation','market','medium','{}','test')", [claimId, businessId]);
    await client.query("insert into evidence (id,business_id,evidence_type,statement,source_type,source_metadata,reliability_level,directness_level,recency_level,raw_payload,materiality) values ($1,$2,'record','Evidence','test','{}','high','direct','current','{}','high')", [evidenceId, businessId]);
    await client.query("insert into metrics (id,business_id,metric_key,metric_label,numeric_value,unit,source_evidence_id) values ($1,$2,'value','Value',1,'count',$3)", [metricId, businessId, evidenceId]);
    await client.query("insert into source_submissions (id,business_id,source_type,raw_text) values ($1,$2,'test','Answer')", [sourceId, businessId]);
    return { businessId, snapshotId, claimId, evidenceId, metricId, sourceId };
  }

  async function insertRun(client: PoolClient, owner: Awaited<ReturnType<typeof seed>>, module: string) {
    const id = randomUUID();
    await client.query("insert into analysis_runs (id,business_id,module,run_type,input_snapshot_id,input_projection_version,input_payload,input_hash,prompt_version,provider,model_identifier,model_configuration) values ($1,$2,$3,'snapshot_analysis',$4,'input_v1','{}',$5,'prompt_v1','test','model','{}')", [id, owner.businessId, module, owner.snapshotId, `hash-${id}`]);
    return id;
  }

  it("enforces same-Business ownership, XOR rules and question provenance", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const first = await seed(client, `Coherence ownership A ${randomUUID()}`);
      const second = await seed(client, `Coherence ownership B ${randomUUID()}`);
      const firstRun = await insertRun(client, first, "ownership_a");
      const secondRun = await insertRun(client, second, "ownership_b");
      await rejectAtSavepoint(client, () => client.query("insert into analysis_runs (business_id,module,run_type,input_snapshot_id,input_projection_version,input_payload,input_hash,prompt_version,provider,model_identifier,model_configuration) values ($1,'cross_snapshot','snapshot_analysis',$2,'input_v1','{}','hash','prompt_v1','test','model','{}')", [first.businessId, second.snapshotId]));
      const contradictionId = randomUUID();
      const gapId = randomUUID();
      await client.query("insert into contradictions (id,business_id,analysis_run_id,area,statement,rationale,materiality,priority_rank) values ($1,$2,$3,'business_and_offer','Conflict','Why','high',1)", [contradictionId, first.businessId, firstRun]);
      await client.query("insert into evidence_gaps (id,business_id,analysis_run_id,area,missing_information,decision_impact,materiality,priority_rank) values ($1,$2,$3,'financial_performance','Gap','Impact','medium',2)", [gapId, first.businessId, firstRun]);
      await rejectAtSavepoint(client, () => client.query("insert into contradictions (business_id,analysis_run_id,area,statement,rationale,materiality,priority_rank) values ($1,$2,'business_and_offer','Bad','Bad','high',3)", [first.businessId, secondRun]));
      await rejectAtSavepoint(client, () => client.query("insert into evidence_gaps (business_id,analysis_run_id,area,missing_information,decision_impact,materiality,priority_rank) values ($1,$2,'business_and_offer','Bad','Bad','high',3)", [first.businessId, secondRun]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_finding_references (business_id,claim_id,role) values ($1,$2,'primary')", [first.businessId, first.claimId]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_finding_references (business_id,contradiction_id,evidence_gap_id,claim_id,role) values ($1,$2,$3,$4,'primary')", [first.businessId, contradictionId, gapId, first.claimId]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_finding_references (business_id,contradiction_id,role) values ($1,$2,'primary')", [first.businessId, contradictionId]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_finding_references (business_id,contradiction_id,claim_id,evidence_id,role) values ($1,$2,$3,$4,'primary')", [first.businessId, contradictionId, first.claimId, first.evidenceId]));
      for (const [column, id] of [["claim_id", second.claimId], ["evidence_id", second.evidenceId], ["metric_id", second.metricId]]) {
        await rejectAtSavepoint(client, () => client.query(`insert into analysis_finding_references (business_id,contradiction_id,${column},role) values ($1,$2,$3,'context')`, [first.businessId, contradictionId, id]));
      }
      const questionId = randomUUID();
      await client.query("insert into analysis_questions (id,business_id,contradiction_id,question,priority_order) values ($1,$2,$3,'Question?',1)", [questionId, first.businessId, contradictionId]);
      await rejectAtSavepoint(client, () => client.query("insert into analysis_questions (business_id,question,priority_order) values ($1,'Bad?',2)", [first.businessId]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_questions (business_id,contradiction_id,evidence_gap_id,question,priority_order) values ($1,$2,$3,'Bad?',2)", [first.businessId, contradictionId, gapId]));
      await client.query("insert into analysis_question_sources (business_id,question_id,source_submission_id) values ($1,$2,$3)", [first.businessId, questionId, first.sourceId]);
      await rejectAtSavepoint(client, () => client.query("insert into analysis_question_sources (business_id,question_id,source_submission_id) values ($1,$2,$3)", [first.businessId, questionId, second.sourceId]));
      await rejectAtSavepoint(client, () => client.query("insert into analysis_question_sources (business_id,question_id,source_submission_id) values ($1,$2,$3)", [first.businessId, questionId, first.sourceId]));
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("enforces equivalent-run idempotency, lifecycle and analytical immutability", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const owner = await seed(client, `Coherence lifecycle ${randomUUID()}`);
      const run = await insertRun(client, owner, "same");
      await rejectAtSavepoint(client, () => insertRun(client, owner, "same"));
      await client.query("update analysis_runs set status='SUCCEEDED',completed_at=now(),structured_output='{}' where id=$1", [run]);
      await rejectAtSavepoint(client, () => insertRun(client, owner, "same"));
      const failedOne = await insertRun(client, owner, "failed");
      await client.query("update analysis_runs set status='FAILED',completed_at=now() where id=$1", [failedOne]);
      const failedTwo = await insertRun(client, owner, "failed");
      await client.query("update analysis_runs set status='FAILED',completed_at=now() where id=$1", [failedTwo]);
      expect((await client.query("select count(*)::int count from analysis_runs where module='failed' and status='FAILED'")).rows[0].count).toBe(2);
      await rejectAtSavepoint(client, () => client.query("update analysis_runs set status='FAILED' where id=$1", [run]));
      const provenance = await insertRun(client, owner, "provenance");
      for (const column of ["business_id", "input_snapshot_id", "input_payload", "input_hash", "prompt_version", "provider", "model_identifier"]) {
        const value = column === "business_id" || column === "input_snapshot_id" ? randomUUID() : column === "input_payload" ? '{"changed":true}' : "changed";
        await rejectAtSavepoint(client, () => client.query(`update analysis_runs set status='FAILED',completed_at=now(),${column}=$2 where id=$1`, [provenance, value]));
      }
      const contradictionId = randomUUID();
      const gapId = randomUUID();
      await client.query("insert into contradictions (id,business_id,analysis_run_id,area,statement,rationale,materiality,priority_rank) values ($1,$2,$3,'business_and_offer','Conflict','Why','high',1)", [contradictionId, owner.businessId, provenance]);
      await client.query("insert into evidence_gaps (id,business_id,analysis_run_id,area,missing_information,decision_impact,materiality,priority_rank) values ($1,$2,$3,'financial_performance','Gap','Impact','medium',2)", [gapId, owner.businessId, provenance]);
      const referenceId = randomUUID();
      const questionId = randomUUID();
      await client.query("insert into analysis_finding_references (id,business_id,contradiction_id,claim_id,role) values ($1,$2,$3,$4,'primary')", [referenceId, owner.businessId, contradictionId, owner.claimId]);
      await client.query("insert into analysis_questions (id,business_id,evidence_gap_id,question,priority_order) values ($1,$2,$3,'Question?',1)", [questionId, owner.businessId, gapId]);
      await client.query("insert into analysis_question_sources (business_id,question_id,source_submission_id) values ($1,$2,$3)", [owner.businessId, questionId, owner.sourceId]);
      for (const [table, predicate, values] of [
        ["contradictions", "id=$1", [contradictionId]], ["evidence_gaps", "id=$1", [gapId]],
        ["analysis_finding_references", "id=$1", [referenceId]], ["analysis_questions", "id=$1", [questionId]],
        ["analysis_question_sources", "question_id=$1 and source_submission_id=$2", [questionId, owner.sourceId]],
      ] as const) {
        await rejectAtSavepoint(client, () => client.query(`update ${table} set created_at=created_at where ${predicate}`, [...values]));
        await rejectAtSavepoint(client, () => client.query(`delete from ${table} where ${predicate}`, [...values]));
      }
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("permanently deletes the 3C graph through the Business-scoped repository", async () => {
    const client = await pool.connect();
    const label = `Coherence deletion ${randomUUID()}`;
    let owner: Awaited<ReturnType<typeof seed>>;
    try {
      owner = await seed(client, label);
      await client.query("update businesses set status='archived',archived_at=now() where id=$1", [owner.businessId]);
      const run = await insertRun(client, owner, "delete");
      await client.query("update analysis_runs set status='SUCCEEDED',completed_at=now(),structured_output='{}' where id=$1", [run]);
      const contradictionId = randomUUID();
      const referenceId = randomUUID();
      const questionId = randomUUID();
      await client.query("insert into contradictions (id,business_id,analysis_run_id,area,statement,rationale,materiality,priority_rank) values ($1,$2,$3,'business_and_offer','Conflict','Why','high',1)", [contradictionId, owner.businessId, run]);
      await client.query("insert into analysis_finding_references (id,business_id,contradiction_id,claim_id,role) values ($1,$2,$3,$4,'primary')", [referenceId, owner.businessId, contradictionId, owner.claimId]);
      await client.query("insert into analysis_questions (id,business_id,contradiction_id,question,priority_order) values ($1,$2,$3,'Question?',1)", [questionId, owner.businessId, contradictionId]);
      await client.query("insert into analysis_question_sources (business_id,question_id,source_submission_id) values ($1,$2,$3)", [owner.businessId, questionId, owner.sourceId]);
    } finally { client.release(); }
    const repository = new BusinessDeletionRepository(database);
    const confirmation = await repository.getConfirmation(owner!.businessId);
    await repository.permanentlyDelete({ businessId: owner!.businessId, confirmation: confirmation.phrase });
    for (const table of [analysisQuestionSources, analysisQuestions, analysisFindingReferences, contradictions, evidenceGaps, analysisRuns] as const) {
      expect((await database.select({ value: count() }).from(table).where(eq(table.businessId, owner!.businessId)))[0].value).toBe(0);
    }
  });

  it("recovers one abandoned run and reuses one competing equivalent PostgreSQL run", async () => {
    vi.stubEnv("AI_RUN_STALE_AFTER_MS", "500");
    const firstPool = new Pool({ connectionString, max: 1 });
    const secondPool = new Pool({ connectionString, max: 1 });
    try {
      const firstDb = drizzle({ client: firstPool }) as unknown as Database;
      const secondDb = drizzle({ client: secondPool }) as unknown as Database;
      const foundation = new FoundationRepository(database);
      const business = await new BusinessService(foundation).create({
        name: `Coherence recovery concurrency ${randomUUID()}`,
      });
      const snapshot = await foundation.createSnapshot(business.id);
      const orchestrator = createStrategyOrchestrator(database);
      for (const [event, actorType] of [
        ["START_INTAKE", "human"],
        ["SUBMIT_INTAKE", "human"],
        ["PROCESS_EVIDENCE", "system"],
        ["MARK_ANALYSIS_COMPLETE", "system"],
      ] as const) await orchestrator.transition({ businessId: business.id, event, actorType });
      const projection = buildEvidenceCoherenceProjection({
        ...snapshot,
        snapshotData: snapshot.snapshotData as Record<string, unknown>,
      });
      const inputPayload = evidenceCoherenceModelInput(projection);
      const identity = {
        businessId: business.id,
        inputSnapshotId: snapshot.id,
        module: EVIDENCE_COHERENCE_MODULE,
        runType: EVIDENCE_COHERENCE_RUN_TYPE,
        inputProjectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
        inputPayload,
        inputHash: hashEvidenceCoherenceProjection(projection),
        promptVersion: EVIDENCE_COHERENCE_PROMPT_VERSION,
        provider: "test",
        modelIdentifier: "abandoned",
        modelConfiguration: {},
      };
      const abandoned = await new EvidenceCoherenceRepository(database).createRun(identity);
      await new Promise((resolve) => setTimeout(resolve, 600));

      let releaseModel!: () => void;
      let announceModel!: () => void;
      const modelStarted = new Promise<void>((resolve) => { announceModel = resolve; });
      const modelRelease = new Promise<void>((resolve) => { releaseModel = resolve; });
      let calls = 0;
      const model = {
        getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
        analyse: async () => {
          calls += 1;
          announceModel();
          await modelRelease;
          const output = { contradictions: [], gaps: [], questions: [] };
          return { output, rawOutput: output };
        },
      };
      const firstService = new EvidenceCoherenceService(
        new EvidenceCoherenceRepository(firstDb), model, createStrategyOrchestrator(firstDb),
      );
      const secondService = new EvidenceCoherenceService(
        new EvidenceCoherenceRepository(secondDb), model, createStrategyOrchestrator(secondDb),
      );
      const firstRequest = firstService.analyseCurrentSnapshot({ businessId: business.id });
      await modelStarted;
      const competing = await secondService.analyseCurrentSnapshot({ businessId: business.id });
      releaseModel();
      const completed = await firstRequest;
      expect(competing).toMatchObject({ reused: true, run: { id: completed.run.id } });
      expect(calls).toBe(1);
      const [oldRun] = await database.select().from(analysisRuns)
        .where(eq(analysisRuns.id, abandoned.run.id));
      expect(oldRun).toMatchObject({ status: "FAILED", modelIdentifier: "abandoned" });
      const active = await database.select().from(analysisRuns)
        .where(eq(analysisRuns.businessId, business.id));
      expect(active.filter((run) => run.status === "SUCCEEDED")).toHaveLength(1);
      expect(active.filter((run) => run.status === "RUNNING")).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  }, 15_000);
});
