import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  analysisRuns,
  businessStateSnapshots,
  businesses,
  claims,
  evidenceReviewSessions,
  proposalReviews,
  workflowTransitions,
} from "@/db/schema";
import { BusinessArchivedError } from "@/repositories/business-lifecycle-guard";
import {
  buildEvidenceCoherenceProjection,
  evidenceCoherenceModelInput,
} from "@/domain/evidence-coherence-projection";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { baslonExtractionOutput } from "../fixtures/baslon-business";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

type NamedDatabase = { applicationName: string; pool: Pool; database: Database };

describe("real PostgreSQL 17 archive/write serialization", () => {
  let controlPool: Pool;
  let database: Database;
  let foundation: FoundationRepository;
  const operationPools: Pool[] = [];

  beforeAll(async () => {
    controlPool = new Pool({ connectionString, max: 6 });
    await verifyPostgresTestDatabase(controlPool);
    database = drizzle({ client: controlPool });
    foundation = new FoundationRepository(database);
  });

  afterEach(async () => {
    await Promise.all(operationPools.splice(0).map((pool) => pool.end()));
  });

  afterAll(async () => controlPool.end());

  function namedDatabase(label: string): NamedDatabase {
    const applicationName = `baslon_${label}_${randomUUID().slice(0, 8)}`;
    const pool = new Pool({ connectionString, application_name: applicationName, max: 1 });
    operationPools.push(pool);
    return { applicationName, pool, database: drizzle({ client: pool }) };
  }

  async function waitUntilLockBlocked(applicationName: string) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await controlPool.query<{ blocked: boolean }>(`
        select exists (
          select 1 from pg_stat_activity
          where application_name = $1 and wait_event_type = 'Lock'
        ) as blocked
      `, [applicationName]);
      if (result.rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${applicationName} to block on a PostgreSQL lock`);
  }

  async function beginArchive(client: PoolClient, businessId: string) {
    await client.query("begin");
    await client.query(
      "update businesses set status = 'archived', archived_at = now(), updated_at = now() where id = $1 and status = 'active'",
      [businessId],
    );
  }

  async function createReview(proposalCount: 0 | 1) {
    const business = await new BusinessService(foundation).create({
      name: `Archive race review ${randomUUID()}`,
    });
    const extraction = new EvidenceExtractionRepository(database);
    const run = await extraction.createRun({
      businessId: business.id,
      rawIntakeText: "The business receives referrals.",
      sourceMetadata: {},
      promptVersion: "race-test-v1",
      provider: "test",
      model: "deterministic",
      modelConfiguration: {},
    });
    const proposal = proposalCount === 1
      ? [{
        proposalRef: "claim_1",
        proposalType: "claim" as const,
        structuredPayload: structuredClone(baslonExtractionOutput.claims[0]),
      }]
      : [];
    await extraction.completeRun({
      runId: run.id,
      businessId: business.id,
      rawModelOutput: {},
      proposals: proposal,
    });
    const [persistedProposal] = await extraction.getProposals(run.id, business.id);
    const repository = new EvidenceReviewRepository(database);
    const session = await repository.startSession({
      businessId: business.id,
      extractionRunId: run.id,
      reviewerId: "race-test-human",
    });
    return { business, run, session, proposal: persistedProposal };
  }

  async function countForBusiness(table: typeof claims | typeof businessStateSnapshots, businessId: string) {
    const [result] = await database.select({ value: count() }).from(table)
      .where(eq(table.businessId, businessId));
    return result.value;
  }

  it("rejects review application when archive owns the Business lock first", async () => {
    const context = await createReview(1);
    const archiveClient = await controlPool.connect();
    const operation = namedDatabase("review_archive_first");
    const service = new EvidenceReviewService(
      new EvidenceReviewRepository(operation.database),
      createStrategyOrchestrator(operation.database),
    );
    try {
      await beginArchive(archiveClient, context.business.id);
      const review = service.reviewProposal({
        businessId: context.business.id,
        reviewSessionId: context.session.id,
        proposalId: context.proposal!.id,
        reviewerId: "race-test-human",
        decision: "ACCEPTED",
      });
      await waitUntilLockBlocked(operation.applicationName);
      await archiveClient.query("commit");
      await expect(review).rejects.toBeInstanceOf(BusinessArchivedError);
      expect(await countForBusiness(claims, context.business.id)).toBe(0);
      expect(await database.select().from(proposalReviews)
        .where(eq(proposalReviews.businessId, context.business.id))).toEqual([]);
    } finally {
      await archiveClient.query("rollback").catch(() => undefined);
      archiveClient.release();
    }
  });

  it("lets review application commit before a waiting archive", async () => {
    const context = await createReview(1);
    const [proposal] = (await new EvidenceReviewRepository(database)
      .getSessionDetails(context.session.id, context.business.id)).proposals;
    const blocker = await controlPool.connect();
    const operation = namedDatabase("review_write_first");
    const archive = namedDatabase("review_archive_waits");
    const service = new EvidenceReviewService(
      new EvidenceReviewRepository(operation.database),
      createStrategyOrchestrator(operation.database),
    );
    try {
      await blocker.query("begin");
      await blocker.query("select id from evidence_review_sessions where id = $1 for update", [context.session.id]);
      const review = service.reviewProposal({
        businessId: context.business.id,
        reviewSessionId: context.session.id,
        proposalId: proposal.id,
        reviewerId: "race-test-human",
        decision: "ACCEPTED",
      });
      await waitUntilLockBlocked(operation.applicationName);
      const archival = new BusinessService(new FoundationRepository(archive.database))
        .archive(context.business.id);
      await waitUntilLockBlocked(archive.applicationName);
      await blocker.query("commit");
      await expect(review).resolves.toMatchObject({ decision: "ACCEPTED" });
      await expect(archival).resolves.toMatchObject({ status: "archived" });
      expect(await countForBusiness(claims, context.business.id)).toBe(1);
      expect(await database.select().from(proposalReviews)
        .where(eq(proposalReviews.businessId, context.business.id))).toHaveLength(1);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
  });

  it("rejects review completion when archive owns the Business lock first", async () => {
    const context = await createReview(0);
    const orchestrator = createStrategyOrchestrator(database);
    for (const [event, actorType] of [
      ["START_INTAKE", "human"],
      ["SUBMIT_INTAKE", "human"],
      ["PROCESS_EVIDENCE", "system"],
    ] as const) await orchestrator.transition({ businessId: context.business.id, event, actorType });
    const archiveClient = await controlPool.connect();
    const operation = namedDatabase("completion_archive_first");
    try {
      await beginArchive(archiveClient, context.business.id);
      const completion = new EvidenceReviewRepository(operation.database).completeSession({
        businessId: context.business.id,
        reviewSessionId: context.session.id,
        reviewerId: "race-test-human",
      });
      await waitUntilLockBlocked(operation.applicationName);
      await archiveClient.query("commit");
      await expect(completion).rejects.toBeInstanceOf(BusinessArchivedError);
      expect(await countForBusiness(businessStateSnapshots, context.business.id)).toBe(0);
      const [session] = await database.select().from(evidenceReviewSessions)
        .where(eq(evidenceReviewSessions.id, context.session.id));
      expect(session).toMatchObject({ status: "OPEN", resultingSnapshotId: null });
    } finally {
      await archiveClient.query("rollback").catch(() => undefined);
      archiveClient.release();
    }
  });

  it("lets review completion commit before a waiting archive", async () => {
    const context = await createReview(0);
    const orchestrator = createStrategyOrchestrator(database);
    for (const [event, actorType] of [
      ["START_INTAKE", "human"],
      ["SUBMIT_INTAKE", "human"],
      ["PROCESS_EVIDENCE", "system"],
    ] as const) await orchestrator.transition({ businessId: context.business.id, event, actorType });
    const blocker = await controlPool.connect();
    const operation = namedDatabase("completion_write_first");
    const archive = namedDatabase("completion_archive_waits");
    try {
      await blocker.query("begin");
      await blocker.query("select id from evidence_review_sessions where id = $1 for update", [context.session.id]);
      const completion = new EvidenceReviewRepository(operation.database).completeSession({
        businessId: context.business.id,
        reviewSessionId: context.session.id,
        reviewerId: "race-test-human",
      });
      await waitUntilLockBlocked(operation.applicationName);
      const archival = new BusinessService(new FoundationRepository(archive.database))
        .archive(context.business.id);
      await waitUntilLockBlocked(archive.applicationName);
      await blocker.query("commit");
      const completed = await completion;
      await archival;
      expect(completed.snapshot.version).toBe(1);
      expect(await countForBusiness(businessStateSnapshots, context.business.id)).toBe(1);
      const [session] = await database.select().from(evidenceReviewSessions)
        .where(eq(evidenceReviewSessions.id, context.session.id));
      expect(session).toMatchObject({ status: "COMPLETED", resultingSnapshotId: completed.snapshot.id });
      const [business] = await database.select().from(businesses).where(eq(businesses.id, context.business.id));
      expect(business.status).toBe("archived");
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
  });

  it("leaves workflow state, version and history unchanged when archive wins", async () => {
    const business = await new BusinessService(foundation).create({ name: `Workflow race ${randomUUID()}` });
    const before = await foundation.getWorkflow(business.id);
    const archiveClient = await controlPool.connect();
    const operation = namedDatabase("workflow_archive_first");
    try {
      await beginArchive(archiveClient, business.id);
      const transition = createStrategyOrchestrator(operation.database).transition({
        businessId: business.id,
        event: "START_INTAKE",
        actorType: "human",
        actorId: "race-test-human",
      });
      await waitUntilLockBlocked(operation.applicationName);
      await archiveClient.query("commit");
      await expect(transition).rejects.toBeInstanceOf(BusinessArchivedError);
      expect(await foundation.getWorkflow(business.id)).toEqual(before);
      expect(await database.select().from(workflowTransitions)
        .where(eq(workflowTransitions.workflowId, before!.id))).toEqual([]);
    } finally {
      await archiveClient.query("rollback").catch(() => undefined);
      archiveClient.release();
    }
  });

  async function coherenceContext() {
    const business = await new BusinessService(foundation).create({ name: `Coherence race ${randomUUID()}` });
    const snapshot = await foundation.createSnapshot(business.id);
    const projection = buildEvidenceCoherenceProjection({
      ...snapshot,
      snapshotData: snapshot.snapshotData as Record<string, unknown>,
    });
    return {
      business,
      snapshot,
      input: {
        businessId: business.id,
        inputSnapshotId: snapshot.id,
        module: "evidence_coherence",
        inputProjectionVersion: "evidence_coherence_input_v1",
        promptVersion: "evidence_coherence_v1",
        runType: "snapshot_analysis",
        inputPayload: evidenceCoherenceModelInput(projection),
        inputHash: randomUUID(),
        provider: "test",
        modelIdentifier: "deterministic",
        modelConfiguration: {},
      },
    };
  }

  it("does not create an Evidence Coherence run when archive wins", async () => {
    const context = await coherenceContext();
    const archiveClient = await controlPool.connect();
    const operation = namedDatabase("coherence_archive_first");
    try {
      await beginArchive(archiveClient, context.business.id);
      const creation = new EvidenceCoherenceRepository(operation.database).createRun(context.input);
      await waitUntilLockBlocked(operation.applicationName);
      await archiveClient.query("commit");
      await expect(creation).rejects.toBeInstanceOf(BusinessArchivedError);
      expect(await database.select().from(analysisRuns)
        .where(eq(analysisRuns.businessId, context.business.id))).toEqual([]);
    } finally {
      await archiveClient.query("rollback").catch(() => undefined);
      archiveClient.release();
    }
  });

  it("lets Evidence Coherence run creation commit before a waiting archive", async () => {
    const context = await coherenceContext();
    const blocker = await controlPool.connect();
    const operation = namedDatabase("coherence_write_first");
    const archive = namedDatabase("coherence_archive_waits");
    try {
      await blocker.query("begin");
      await blocker.query("select id from business_state_snapshots where id = $1 for update", [context.snapshot.id]);
      const creation = new EvidenceCoherenceRepository(operation.database).createRun(context.input);
      await waitUntilLockBlocked(operation.applicationName);
      const archival = new BusinessService(new FoundationRepository(archive.database))
        .archive(context.business.id);
      await waitUntilLockBlocked(archive.applicationName);
      await blocker.query("commit");
      await expect(creation).resolves.toMatchObject({ created: true });
      await expect(archival).resolves.toMatchObject({ status: "archived" });
      expect(await database.select().from(analysisRuns)
        .where(eq(analysisRuns.businessId, context.business.id))).toHaveLength(1);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
  });
});
