import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  approvedDiagnoses,
  diagnosisCalculationSources,
  diagnosisCalculations,
  diagnosisItemReferences,
  diagnosisItemReviews,
  diagnosisItems,
  diagnosisReviewSessions,
} from "@/db/schema";
import { AddInformationRepository } from "@/repositories/add-information-repository";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { AddInformationService } from "@/services/add-information-service";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { RevisionRequiresNewSnapshotError } from "@/services/phase1-diagnosis-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";
import {
  FakeDiagnosisModel,
  diagnosisService,
  phase1ReadyBusiness,
  validDiagnosis,
} from "../fixtures/phase1-diagnosis-fixture";

const connectionString = requirePostgresTestDatabaseUrl();

describe("real PostgreSQL 17 Phase 1 Diagnosis integrity (synthetic data only)", () => {
  let pool: Pool;
  let database: Database;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool }) as unknown as Database;
  });

  afterAll(async () => pool.end());

  async function rejectAtSavepoint(client: PoolClient, action: () => Promise<unknown>, message: string) {
    const name = `sp_${randomUUID().replaceAll("-", "")}`;
    await client.query(`savepoint ${name}`);
    let error: unknown;
    try { await action(); } catch (caught) { error = caught; }
    await client.query(`rollback to savepoint ${name}`);
    await client.query(`release savepoint ${name}`);
    expect(error).toBeDefined();
    expect(String((error as Error).message)).toContain(message);
  }

  /** Two synthetic Businesses with one reviewed diagnosis run each. */
  async function twoDiagnosedRuns() {
    const first = await phase1ReadyBusiness(database, `Diagnosis integrity A ${randomUUID()}`);
    const firstRun = (await diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), first.orchestrator)
      .generate({ businessId: first.business.id })).run;
    const second = await phase1ReadyBusiness(database, `Diagnosis integrity B ${randomUUID()}`);
    const secondRun = (await diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), second.orchestrator)
      .generate({ businessId: second.business.id })).run;
    return { first, firstRun, second, secondRun };
  }

  it("runs the full flow on PostgreSQL 17 and stops at the human review checkpoint", async () => {
    const fixture = await phase1ReadyBusiness(database, `Diagnosis flow ${randomUUID()}`);
    const service = diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    expect(run.status).toBe("SUCCEEDED");
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id));
    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    for (const item of items) {
      await service.reviewItem({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer", diagnosisItemId: item.id, decision: "ACCEPTED" });
    }
    const approved = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    expect(approved).toMatchObject({ analysisRunId: run.id, snapshotId: fixture.snapshot.id, version: 1 });
  });

  it("enforces same-run composite FKs between reviews, sessions, items, calculations and approvals", async () => {
    const { first, firstRun, secondRun } = await twoDiagnosedRuns();
    const [firstItem] = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, firstRun.id));
    const [secondCalculation] = await database.select().from(diagnosisCalculations).where(eq(diagnosisCalculations.analysisRunId, secondRun.id));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const sessionId = randomUUID();
      await client.query("insert into diagnosis_review_sessions (id,business_id,analysis_run_id,reviewer_id) values ($1,$2,$3,'Reviewer')", [sessionId, first.business.id, firstRun.id]);
      // A review whose session and item belong to different runs.
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'ACCEPTED')",
        [first.business.id, secondRun.id, sessionId, firstItem.id],
      ), "violates foreign key constraint");
      // A reference from an item of run A to a calculation of run B (different Business too).
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_references (business_id,analysis_run_id,diagnosis_item_id,role,diagnosis_calculation_id) values ($1,$2,$3,'primary',$4)",
        [first.business.id, firstRun.id, firstItem.id, secondCalculation.id],
      ), "");
      // An approval whose session reviewed a different run.
      await rejectAtSavepoint(client, () => client.query(
        `insert into approved_diagnoses (business_id,analysis_run_id,review_session_id,snapshot_id,snapshot_version,input_projection_version,prompt_version,input_hash,artifact_version,version,approved_by,approved_content)
         values ($1,$2,$3,$4,1,'phase1_diagnosis_input_v1','phase1_diagnosis_v1','x','phase1_diagnosis_artifact_v1',99,'Reviewer','{}')`,
        [first.business.id, secondRun.id, sessionId, first.snapshot.id],
      ), "");
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("allows diagnosis output only while its own phase1_diagnosis run is RUNNING", async () => {
    const { first, firstRun } = await twoDiagnosedRuns();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_items (business_id,analysis_run_id,item_ref,item_type,statement,rationale,grounding,materiality) values ($1,$2,'I099','risk','Late item','Late','evidence_backed','high')",
        [first.business.id, firstRun.id],
      ), "can only be written while its diagnosis run is RUNNING");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_items (business_id,analysis_run_id,item_ref,item_type,statement,rationale,grounding,materiality) values ($1,$2,'I099','risk','Wrong module','Wrong','evidence_backed','high')",
        [first.business.id, first.coherenceRun.id],
      ), "must belong to a phase1_diagnosis analysis run");
      await client.query("rollback");
      // The output guard fires first on terminal runs, so confirm the limitations rule is also a table constraint.
      const constraint = await client.query<{ definition: string }>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'diagnosis_items_interpretation_limitations_check'",
      );
      expect(constraint.rows[0]?.definition).toContain("interpretive");
    } finally { client.release(); }
  });

  it("completes a review only when every item has exactly one decision, and keeps decisions immutable", async () => {
    const { first, firstRun } = await twoDiagnosedRuns();
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, firstRun.id));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const sessionId = randomUUID();
      await client.query("insert into diagnosis_review_sessions (id,business_id,analysis_run_id,reviewer_id) values ($1,$2,$3,'Reviewer')", [sessionId, first.business.id, firstRun.id]);
      await client.query("insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'ACCEPTED')", [first.business.id, firstRun.id, sessionId, items[0].id]);
      await rejectAtSavepoint(client, () => client.query(
        "update diagnosis_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [sessionId],
      ), "every diagnosis item requires exactly one decision");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'REJECTED')",
        [first.business.id, firstRun.id, sessionId, items[0].id],
      ), "diagnosis_item_reviews_item_unique");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'CORRECTED')",
        [first.business.id, firstRun.id, sessionId, items[1].id],
      ), "diagnosis_item_reviews_corrected_payload_check");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'UNRESOLVED')",
        [first.business.id, firstRun.id, sessionId, items[1].id],
      ), "diagnosis_item_reviews_decision_check");
      await rejectAtSavepoint(client, () => client.query("update diagnosis_item_reviews set decision='REJECTED' where review_session_id=$1", [sessionId]), "records are immutable");
      for (const item of items.slice(1)) {
        await client.query("insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'REJECTED')", [first.business.id, firstRun.id, sessionId, item.id]);
      }
      await client.query("update diagnosis_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [sessionId]);
      await rejectAtSavepoint(client, () => client.query("update diagnosis_review_sessions set reviewer_id='Other' where id=$1", [sessionId]), "completed diagnosis_review_sessions records are immutable");
      await rejectAtSavepoint(client, () => client.query(
        "insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'ACCEPTED')",
        [first.business.id, firstRun.id, sessionId, randomUUID()],
      ), "");
      // An approval that misstates its run's input hash is refused.
      await rejectAtSavepoint(client, () => client.query(
        `insert into approved_diagnoses (business_id,analysis_run_id,review_session_id,snapshot_id,snapshot_version,input_projection_version,prompt_version,input_hash,artifact_version,version,approved_by,approved_content)
         values ($1,$2,$3,$4,$5,'phase1_diagnosis_input_v1','phase1_diagnosis_v1','not-the-hash','phase1_diagnosis_artifact_v1',1,'Reviewer','{}')`,
        [first.business.id, firstRun.id, sessionId, first.snapshot.id, first.snapshot.version],
      ), "exact snapshot, versions and input hash");
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("refuses an approved_diagnoses row and PHASE1_APPROVED for an all-rejected review (database backstop)", async () => {
    const { first, firstRun } = await twoDiagnosedRuns();
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, firstRun.id));
    const client = await pool.connect();
    const approvalInsert = (sessionId: string) => client.query(
      `insert into approved_diagnoses (business_id,analysis_run_id,review_session_id,snapshot_id,snapshot_version,input_projection_version,prompt_version,input_hash,artifact_version,version,approved_by,approved_content)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'phase1_diagnosis_artifact_v1',1,'Reviewer','{}')`,
      [first.business.id, firstRun.id, sessionId, first.snapshot.id, first.snapshot.version, firstRun.inputProjectionVersion, firstRun.promptVersion, firstRun.inputHash],
    );
    try {
      await client.query("begin");
      const sessionId = randomUUID();
      await client.query("insert into diagnosis_review_sessions (id,business_id,analysis_run_id,reviewer_id) values ($1,$2,$3,'Reviewer')", [sessionId, first.business.id, firstRun.id]);
      for (const item of items) {
        await client.query("insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,'REJECTED')", [first.business.id, firstRun.id, sessionId, item.id]);
      }
      // Completing an all-rejected review is allowed (every item decided); approving it is not.
      await client.query("update diagnosis_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [sessionId]);
      await rejectAtSavepoint(client, () => approvalInsert(sessionId), "requires at least one ACCEPTED or CORRECTED item");
      await client.query("rollback");

      // Control: the same insert succeeds once one item survives review.
      await client.query("begin");
      const survivingSession = randomUUID();
      await client.query("insert into diagnosis_review_sessions (id,business_id,analysis_run_id,reviewer_id) values ($1,$2,$3,'Reviewer')", [survivingSession, first.business.id, firstRun.id]);
      for (const [index, item] of items.entries()) {
        await client.query("insert into diagnosis_item_reviews (business_id,analysis_run_id,review_session_id,diagnosis_item_id,decision) values ($1,$2,$3,$4,$5)", [first.business.id, firstRun.id, survivingSession, item.id, index === 0 ? "ACCEPTED" : "REJECTED"]);
      }
      await client.query("update diagnosis_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [survivingSession]);
      await approvalInsert(survivingSession);
      await client.query("rollback");
    } finally { client.release(); }
    expect(await database.select({ value: count() }).from(approvedDiagnoses).where(eq(approvedDiagnoses.businessId, first.business.id))).toEqual([{ value: 0 }]);
    await expect(first.orchestrator.transition({
      businessId: first.business.id, event: "APPROVE_PHASE1", actorType: "human", actorId: "Reviewer",
      metadata: { approvedDiagnosisId: randomUUID() },
    })).rejects.toThrow("Approved diagnosis not found");
  });

  it("refuses an all-rejected approval through the service and leaves the workflow in review", async () => {
    const fixture = await phase1ReadyBusiness(database, `Diagnosis all rejected ${randomUUID()}`);
    const service = diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id));
    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    for (const item of items) {
      await service.reviewItem({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer", diagnosisItemId: item.id, decision: "REJECTED" });
    }
    await expect(service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" }))
      .rejects.toThrow("An all-rejected diagnosis cannot be approved");
    expect(await database.select({ value: count() }).from(approvedDiagnoses).where(eq(approvedDiagnoses.businessId, fixture.business.id))).toEqual([{ value: 0 }]);
    const [workflow] = await pool.query("select state from strategy_workflows where business_id=$1", [fixture.business.id]).then((result) => result.rows);
    expect(workflow.state).toBe("PHASE1_AWAITING_REVIEW");
  });

  it("refuses same-snapshot re-diagnosis in REVISION_REQUIRED and returns through Add Information (v1)", async () => {
    const fixture = await phase1ReadyBusiness(database, `Diagnosis revision ${randomUUID()}`);
    const businessId = fixture.business.id;
    const model = new FakeDiagnosisModel(validDiagnosis);
    const service = diagnosisService(database, model, fixture.orchestrator);
    await service.generate({ businessId });
    await service.requestRevision({ businessId, reason: "Needs new evidence" });
    const counts = async () => pool.query(`select
        (select count(*) from analysis_runs where business_id=$1 and module='phase1_diagnosis')::int as runs,
        (select count(*) from workflow_transitions t join strategy_workflows w on w.id=t.workflow_id
          where w.business_id=$1 and t.event='GENERATE_PHASE1')::int as generates,
        (select state from strategy_workflows where business_id=$1) as state`, [businessId]).then((result) => result.rows[0]);
    const before = await counts();
    expect(before).toEqual({ runs: 1, generates: 1, state: "REVISION_REQUIRED" });

    await expect(service.generate({ businessId })).rejects.toBeInstanceOf(RevisionRequiresNewSnapshotError);
    await expect(fixture.orchestrator.transition({ businessId, event: "GENERATE_PHASE1", actorType: "human", actorId: "Reviewer", metadata: {} }))
      .rejects.toThrow("Invalid workflow transition: REVISION_REQUIRED + GENERATE_PHASE1");
    expect(model.calls).toBe(1);
    expect(await counts()).toEqual(before);

    const addInformation = new AddInformationService(
      new AddInformationRepository(database),
      new SourceSubmissionService(new SourceSubmissionRepository(database)),
      new EvidenceExtractionService(new EvidenceExtractionRepository(database), {
        getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
        extract: async () => ({ output: { claims: [], evidence: [], metrics: [], relationships: [] }, rawOutput: {} }),
      }),
      new EvidenceReviewService(new EvidenceReviewRepository(database), fixture.orchestrator),
    );
    await addInformation.submit({ businessId, rawText: "Synthetic follow-up information for the revision." });
    const [transition] = await pool.query(`select t.event, t.from_state, t.to_state from workflow_transitions t
      join strategy_workflows w on w.id=t.workflow_id where w.business_id=$1 order by t.created_at desc limit 1`, [businessId])
      .then((result) => result.rows);
    expect(transition).toEqual({ event: "ADD_EVIDENCE", from_state: "REVISION_REQUIRED", to_state: "EVIDENCE_PROCESSING" });
  });

  it("keeps diagnosis output and calculations immutable", async () => {
    const { firstRun } = await twoDiagnosedRuns();
    const expectImmutable = async (operation: PromiseLike<unknown>) => {
      const error = await Promise.resolve(operation).then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeDefined();
      const cause = (error as { cause?: { message?: string } }).cause;
      expect(cause?.message ?? (error as Error).message).toContain("records are immutable");
    };
    await expectImmutable(database.update(diagnosisItems).set({ statement: "Rewritten" }).where(eq(diagnosisItems.analysisRunId, firstRun.id)));
    await expectImmutable(database.delete(diagnosisItemReferences).where(eq(diagnosisItemReferences.analysisRunId, firstRun.id)));
    await expectImmutable(database.update(diagnosisCalculations).set({ label: "Changed" }).where(eq(diagnosisCalculations.analysisRunId, firstRun.id)));
    const [calculation] = await database.select().from(diagnosisCalculations).where(eq(diagnosisCalculations.analysisRunId, firstRun.id));
    await expectImmutable(database.delete(diagnosisCalculationSources).where(eq(diagnosisCalculationSources.diagnosisCalculationId, calculation.id)));
  });

  it("permanently deletes the whole diagnosis graph with its archived synthetic Business", async () => {
    const fixture = await phase1ReadyBusiness(database, `Diagnosis delete ${randomUUID()}`);
    const service = diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id));
    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    for (const [index, item] of items.entries()) {
      await service.reviewItem({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer", diagnosisItemId: item.id, decision: index === 0 ? "ACCEPTED" : "REJECTED" });
    }
    await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    const business = new BusinessService(new FoundationRepository(database), new BusinessDeletionRepository(database));
    await business.archive(fixture.business.id);
    await business.permanentlyDelete({ businessId: fixture.business.id, confirmation: fixture.business.name });
    for (const table of [approvedDiagnoses, diagnosisItemReviews, diagnosisReviewSessions, diagnosisItemReferences, diagnosisCalculationSources, diagnosisItems, diagnosisCalculations]) {
      expect(await database.select({ value: count() }).from(table).where(eq(table.businessId, fixture.business.id))).toEqual([{ value: 0 }]);
    }
  });
});
