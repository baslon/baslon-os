import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  approvedDiagnoses,
  approvedDiagnosisHeadlines,
  approvedDiagnosisHeadlineSets,
  diagnosisHeadlineProposals,
  diagnosisHeadlineReviews,
  diagnosisHeadlineReviewSessions,
  diagnosisItems,
} from "@/db/schema";
import type { DiagnosisHeadlineModelInput } from "@/ai/diagnosis-headlines/contracts";
import { DIAGNOSIS_HEADLINES_PROMPT_VERSION } from "@/ai/diagnosis-headlines/prompt";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { DiagnosisHeadlineRepository } from "@/repositories/diagnosis-headline-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { BusinessService } from "@/services/business-service";
import { DiagnosisHeadlineService } from "@/services/diagnosis-headline-service";
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

/** Synthetic labels only, carrying no number their statement does not have. */
const labels: Record<string, string> = {
  I001: "Revenue is roughly a quarter of a million a year",
  I002: "Profitability cannot yet be established",
  I003: "Recurring revenue adds a steady base",
};
const labelFor = (handle: string) => labels[handle] ?? "A plain synthetic label";

const headlineModel = {
  getConfiguration: () => ({
    provider: "fake", model: "headline-test",
    promptVersion: DIAGNOSIS_HEADLINES_PROMPT_VERSION, metadata: { deterministic: true },
  }),
  propose: async (input: DiagnosisHeadlineModelInput) => {
    const output = { headlines: input.items.map((item) => ({ itemHandle: item.itemHandle, headline: labelFor(item.itemHandle) })) };
    return { output, rawOutput: output };
  },
};

describe("real PostgreSQL 17 companion headline integrity (synthetic data only)", () => {
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

  const headlineService = () => new DiagnosisHeadlineService(new DiagnosisHeadlineRepository(database), headlineModel);

  /** A synthetic Business with an approved v1 diagnosis; one item may be rejected. */
  async function approvedBusiness(name: string, options: { reject?: string } = {}) {
    const fixture = await phase1ReadyBusiness(database, `${name} ${randomUUID()}`);
    const service = diagnosisService(database, new FakeDiagnosisModel(validDiagnosis), fixture.orchestrator);
    const { run } = await service.generate({ businessId: fixture.business.id });
    const items = await database.select().from(diagnosisItems).where(eq(diagnosisItems.analysisRunId, run.id))
      .then((rows) => rows.toSorted((left, right) => left.itemRef.localeCompare(right.itemRef)));
    const session = await service.startReview({ businessId: fixture.business.id, runId: run.id, reviewerId: "Reviewer" });
    for (const item of items) {
      await service.reviewItem({
        businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer",
        diagnosisItemId: item.id, decision: options.reject === item.itemRef ? "REJECTED" : "ACCEPTED",
        ...(options.reject === item.itemRef ? { reason: "Not supported" } : {}),
      });
    }
    const approved = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    return { ...fixture, run, items, approved };
  }

  /** Proposals, review and an approved headline set for one approved diagnosis. */
  async function approvedHeadlineSet(name: string) {
    const fixture = await approvedBusiness(name);
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const session = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    const proposals = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.analysisRunId, run.id));
    for (const proposal of proposals) {
      await service.reviewHeadline({
        businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer",
        diagnosisItemId: proposal.diagnosisItemId, decision: "ACCEPTED",
      });
    }
    const headlineSet = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    return { ...fixture, proposalRun: run, session, proposals, headlineSet };
  }

  it("applies migration 0008 additively: a nullable headline column and the companion tables", async () => {
    const column = await pool.query<{ is_nullable: string; data_type: string }>(
      "select is_nullable, data_type from information_schema.columns where table_name='diagnosis_items' and column_name='headline'",
    );
    expect(column.rows[0]).toEqual({ is_nullable: "YES", data_type: "text" });
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_name like '%headline%' order by 1",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "approved_diagnosis_headline_sets",
      "approved_diagnosis_headlines",
      "diagnosis_headline_proposals",
      "diagnosis_headline_review_sessions",
      "diagnosis_headline_reviews",
    ]);
    // Historical v1 rows keep a null headline: nothing was backfilled.
    const backfilled = await pool.query<{ value: string }>(
      `select count(*)::text as value from diagnosis_items item
       join analysis_runs run on run.id = item.analysis_run_id
       where run.prompt_version = 'phase1_diagnosis_v1' and item.headline is not null`,
    );
    expect(backfilled.rows[0].value).toBe("0");
  });

  it("requires a headline on v2 diagnosis items, refuses one on v1 items, and checks its structure", async () => {
    const fixture = await phase1ReadyBusiness(database, `Headline write guard ${randomUUID()}`);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const insertRun = async (promptVersion: string) => {
        const runId = randomUUID();
        await client.query(
          `insert into analysis_runs (id,business_id,module,run_type,input_snapshot_id,input_projection_version,input_payload,input_hash,prompt_version,provider,model_identifier)
           values ($1,$2,'phase1_diagnosis','snapshot_diagnosis',$3,'phase1_diagnosis_input_v1','{}','hash',$4,'fake','model')`,
          [runId, fixture.business.id, fixture.snapshot.id, promptVersion],
        );
        return runId;
      };
      const item = (runId: string, headline: string | null, ref = "I001") => client.query(
        `insert into diagnosis_items (business_id,analysis_run_id,item_ref,item_type,statement,rationale,grounding,materiality,headline)
         values ($1,$2,$3,'risk','A synthetic statement.','Because.','evidence_backed','high',$4)`,
        [fixture.business.id, runId, ref, headline],
      );

      const v1Run = await insertRun("phase1_diagnosis_v1");
      await rejectAtSavepoint(client, () => item(v1Run, "A headline a v1 item may not carry"),
        "phase1_diagnosis_v1 diagnosis items have no headline");
      await item(v1Run, null);

      const v2Run = await insertRun("phase1_diagnosis_v2");
      await rejectAtSavepoint(client, () => item(v2Run, null), "phase1_diagnosis_v2 diagnosis items require a headline");
      await rejectAtSavepoint(client, () => item(v2Run, "x".repeat(121)), "diagnosis_items_headline_check");
      await rejectAtSavepoint(client, () => item(v2Run, "Two\nlines"), "diagnosis_items_headline_check");
      await rejectAtSavepoint(client, () => item(v2Run, " untrimmed"), "diagnosis_items_headline_check");
      await rejectAtSavepoint(client, () => item(v2Run, "!!!"), "diagnosis_items_headline_check");
      await item(v2Run, "A valid v2 headline");

      const unknownRun = await insertRun("phase1_diagnosis_v9");
      await rejectAtSavepoint(client, () => item(unknownRun, "Anything"), "unsupported phase1_diagnosis prompt version");
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("binds an approved diagnosis to the artifact contract of its run prompt version", async () => {
    const fixture = await approvedBusiness("Headline artifact binding");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const [session] = await pool.query<{ id: string }>(
        "select id from diagnosis_review_sessions where analysis_run_id=$1", [fixture.run.id],
      ).then((result) => result.rows);
      await rejectAtSavepoint(client, () => client.query(
        `insert into approved_diagnoses (business_id,analysis_run_id,review_session_id,snapshot_id,snapshot_version,input_projection_version,prompt_version,input_hash,artifact_version,version,approved_by,approved_content)
         select business_id,analysis_run_id,review_session_id,snapshot_id,snapshot_version,input_projection_version,prompt_version,input_hash,'phase1_diagnosis_artifact_v2',99,'Reviewer','{}'
         from approved_diagnoses where id=$1`, [fixture.approved.id],
      ), "artifact contract of its run prompt version");
      expect(session.id).toBeDefined();
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("keeps every companion headline bound to its exact approved diagnosis, run, Business and effective item", async () => {
    const first = await approvedBusiness("Headline binding A", { reject: "I003" });
    const second = await approvedBusiness("Headline binding B");
    const service = headlineService();
    const { run } = await service.propose({ businessId: first.business.id, approvedDiagnosisId: first.approved.id });
    const rejected = first.items.find((item) => item.itemRef === "I003")!;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const proposal = (businessId: string, runId: string, approvedId: string, diagnosisRunId: string, itemId: string, ref: string) => client.query(
        `insert into diagnosis_headline_proposals (business_id,analysis_run_id,approved_diagnosis_id,diagnosis_run_id,diagnosis_item_id,item_ref,headline)
         values ($1,$2,$3,$4,$5,$6,'A synthetic label')`,
        [businessId, runId, approvedId, diagnosisRunId, itemId, ref],
      );
      // A REJECTED item can never carry a headline.
      await rejectAtSavepoint(client, () => proposal(first.business.id, run.id, first.approved.id, first.run.id, rejected.id, "I003"),
        "may only label an ACCEPTED or CORRECTED item of its approved diagnosis");
      // Another Business's item, and another Business's approved diagnosis, are refused.
      await rejectAtSavepoint(client, () => proposal(first.business.id, run.id, first.approved.id, first.run.id, second.items[0].id, "I001"),
        "may only label an ACCEPTED or CORRECTED item of its approved diagnosis");
      await rejectAtSavepoint(client, () => proposal(first.business.id, run.id, second.approved.id, second.run.id, second.items[0].id, "I001"),
        "may only label an ACCEPTED or CORRECTED item of its approved diagnosis");
      // The audit copy of the handle must match the item it labels.
      await rejectAtSavepoint(client, () => proposal(first.business.id, run.id, first.approved.id, first.run.id, first.items[0].id, "I002"),
        "item_ref must match its diagnosis item");
      // Proposals belong to a RUNNING diagnosis_headlines run only.
      await rejectAtSavepoint(client, () => proposal(first.business.id, run.id, first.approved.id, first.run.id, first.items[0].id, "I001"),
        "can only be written while their run is RUNNING");
      await rejectAtSavepoint(client, () => proposal(first.business.id, first.run.id, first.approved.id, first.run.id, first.items[0].id, "I001"),
        "must belong to a diagnosis_headlines analysis run");
      await client.query("rollback");
    } finally { client.release(); }

    // The same-Business, same-run bindings are also composite foreign keys.
    const constraints = await pool.query<{ conname: string; definition: string }>(
      `select conname, pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid::regclass::text in ('diagnosis_headline_proposals','diagnosis_headline_reviews',
         'approved_diagnosis_headline_sets','approved_diagnosis_headlines')
         and contype = 'f' order by conname`,
    );
    const definitionOf = (name: string) => constraints.rows.find((row) => row.conname === name)?.definition ?? "";
    expect(definitionOf("diagnosis_headline_proposals_item_same_run_fk"))
      .toContain("REFERENCES diagnosis_items(id, business_id, analysis_run_id)");
    expect(definitionOf("diagnosis_headline_proposals_approved_same_run_fk"))
      .toContain("REFERENCES approved_diagnoses(id, business_id, analysis_run_id)");
    expect(definitionOf("approved_diagnosis_headline_sets_approved_exact_fk"))
      .toContain("REFERENCES approved_diagnoses(id, business_id, analysis_run_id, version)");
    expect(definitionOf("approved_diagnosis_headlines_item_same_run_fk"))
      .toContain("REFERENCES diagnosis_items(id, business_id, analysis_run_id)");
  });

  it("requires a complete proposal set to review, one open review at a time, and every headline decided", async () => {
    const fixture = await approvedBusiness("Headline review guard");
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const session = (runId: string, version = 1) => client.query(
        `insert into diagnosis_headline_review_sessions (business_id,approved_diagnosis_id,diagnosis_run_id,proposal_run_id,set_version,reviewer_id)
         values ($1,$2,$3,$4,$5,'Reviewer') returning id`,
        [fixture.business.id, fixture.approved.id, fixture.run.id, runId, version],
      );
      // The proposal run must be a successful diagnosis_headlines run.
      await rejectAtSavepoint(client, () => session(fixture.run.id), "requires a successful diagnosis_headlines run");
      // A review prepares the next set version, not any version.
      await rejectAtSavepoint(client, () => session(run.id, 2), "must prepare the next headline set version (1)");
      const first = await session(run.id);
      // Only one open headline review per approved diagnosis.
      await rejectAtSavepoint(client, () => session(run.id), "duplicate key value");
      // A review completes only when every effective item has a decision.
      await rejectAtSavepoint(client, () => client.query(
        "update diagnosis_headline_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [first.rows[0].id],
      ), "every effective item requires a final headline");
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("approves a set only as the exact reviewed headlines, complete, versioned and immutable", async () => {
    const fixture = await approvedHeadlineSet("Headline set guard");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const [review] = await pool.query<{ id: string; diagnosis_item_id: string; proposal_id: string }>(
        "select id, diagnosis_item_id, proposal_id from diagnosis_headline_reviews where review_session_id=$1 limit 1",
        [fixture.session.id],
      ).then((result) => result.rows);
      // An approved headline must be exactly its reviewed headline.
      await rejectAtSavepoint(client, () => client.query(
        `insert into approved_diagnosis_headlines (business_id,headline_set_id,approved_diagnosis_id,diagnosis_run_id,review_session_id,diagnosis_item_id,review_id,item_ref,headline)
         values ($1,$2,$3,$4,$5,$6,$7,'I001','A headline nobody reviewed')`,
        [fixture.business.id, fixture.headlineSet.id, fixture.approved.id, fixture.run.id, fixture.session.id, review.diagnosis_item_id, review.id],
      ), "must be exactly its reviewed headline");
      // A completed review and an approved set are immutable, and a set is never updated in place.
      await rejectAtSavepoint(client, () => client.query(
        "update approved_diagnosis_headline_sets set version=9 where id=$1", [fixture.headlineSet.id],
      ), "records are immutable");
      await rejectAtSavepoint(client, () => client.query(
        "update approved_diagnosis_headlines set headline='Rewritten' where headline_set_id=$1", [fixture.headlineSet.id],
      ), "records are immutable");
      await rejectAtSavepoint(client, () => client.query(
        "update diagnosis_headline_reviews set corrected_headline='Rewritten' where id=$1", [review.id],
      ), "records are immutable");
      await rejectAtSavepoint(client, () => client.query(
        "update diagnosis_headline_review_sessions set reviewer_id='Someone else' where id=$1", [fixture.session.id],
      ), "immutable");
      // Exact duplicates within one set are refused by the database.
      const duplicate = await pool.query<{ headline: string; item_ref: string }>(
        "select headline, item_ref from approved_diagnosis_headlines where headline_set_id=$1 order by item_ref", [fixture.headlineSet.id],
      );
      expect(duplicate.rows).toHaveLength(3);
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("completes a headline review only by approving a complete set, in one transaction", async () => {
    const fixture = await approvedBusiness("Headline set completeness");
    const service = headlineService();
    const { run } = await service.propose({ businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id });
    const session = await service.startReview({
      businessId: fixture.business.id, approvedDiagnosisId: fixture.approved.id, proposalRunId: run.id, reviewerId: "Reviewer",
    });
    const proposals = await database.select().from(diagnosisHeadlineProposals)
      .where(eq(diagnosisHeadlineProposals.analysisRunId, run.id));
    for (const proposal of proposals) {
      await service.reviewHeadline({
        businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer",
        diagnosisItemId: proposal.diagnosisItemId, decision: "ACCEPTED",
      });
    }
    const client = await pool.connect();
    try {
      // Completing the review without approving a set is refused at commit.
      await client.query("begin");
      await client.query("update diagnosis_headline_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [session.id]);
      let error: unknown;
      try { await client.query("commit"); } catch (caught) { error = caught; }
      expect(String((error as Error).message)).toContain("completes only by approving its headline set");
      // A set missing one item's headline is refused at commit.
      await client.query("begin");
      await client.query("update diagnosis_headline_review_sessions set status='COMPLETED', completed_at=now() where id=$1", [session.id]);
      await client.query(
        `insert into approved_diagnosis_headline_sets (business_id,approved_diagnosis_id,approved_diagnosis_version,diagnosis_run_id,proposal_run_id,review_session_id,version,approved_by)
         values ($1,$2,$3,$4,$5,$6,1,'Reviewer')`,
        [fixture.business.id, fixture.approved.id, fixture.approved.version, fixture.run.id, run.id, session.id],
      );
      error = undefined;
      try { await client.query("commit"); } catch (caught) { error = caught; }
      expect(String((error as Error).message)).toContain("exactly one headline for every effective item");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    // The review is still open and approvable through the application.
    const headlineSet = await service.approve({ businessId: fixture.business.id, reviewSessionId: session.id, reviewerId: "Reviewer" });
    expect(headlineSet.version).toBe(1);
  });

  it("permanently deletes companion headlines with their archived synthetic Business", async () => {
    const fixture = await approvedHeadlineSet("Headline delete");
    const business = new BusinessService(new FoundationRepository(database), new BusinessDeletionRepository(database));
    await business.archive(fixture.business.id);
    await business.permanentlyDelete({ businessId: fixture.business.id, confirmation: fixture.business.name });
    for (const table of [
      approvedDiagnosisHeadlines, approvedDiagnosisHeadlineSets, diagnosisHeadlineReviews,
      diagnosisHeadlineReviewSessions, diagnosisHeadlineProposals, approvedDiagnoses, diagnosisItems,
    ]) {
      expect(await database.select({ value: count() }).from(table).where(eq(table.businessId, fixture.business.id))).toEqual([{ value: 0 }]);
    }
  });
});
