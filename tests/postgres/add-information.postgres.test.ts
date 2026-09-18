import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { addInformationScenarios } from "../fixtures/add-information-scenarios";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { AddInformationRepository } from "@/repositories/add-information-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { AddInformationService } from "@/services/add-information-service";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import { BusinessArchivedError } from "@/repositories/business-lifecycle-guard";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();
describe("PostgreSQL 17 Add Information", () => {
  const pool = new Pool({ connectionString, max: 10 });
  const database = drizzle({ client: pool, schema });
  const operationPools: Pool[] = [];
  beforeAll(async () => {
    await verifyPostgresTestDatabase(pool);
  });
  afterEach(async () => {
    await Promise.all(operationPools.splice(0).map((item) => item.end()));
  });
  afterAll(async () => pool.end());
  addInformationScenarios(() => database);

  function namedDatabase(label: string) {
    const applicationName = `baslon_add_${label}_${randomUUID().slice(0, 8)}`;
    const operationPool = new Pool({
      connectionString,
      application_name: applicationName,
      max: 1,
    });
    operationPools.push(operationPool);
    return {
      applicationName,
      database: drizzle({ client: operationPool, schema }),
    };
  }

  function serviceFor(target: Database, shouldFail = false) {
    const sources = new SourceSubmissionService(new SourceSubmissionRepository(target));
    const extraction = new EvidenceExtractionService(
      new EvidenceExtractionRepository(target),
      {
        getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
        extract: async () => {
          if (shouldFail) throw new Error("forced model failure");
          return {
            output: { claims: [], evidence: [], metrics: [], relationships: [] },
            rawOutput: {},
          };
        },
      },
    );
    return new AddInformationService(
      new AddInformationRepository(target),
      sources,
      extraction,
      new EvidenceReviewService(
        new EvidenceReviewRepository(target),
        createStrategyOrchestrator(target),
      ),
    );
  }

  async function moveToEvidenceReady(target: Database, businessId: string) {
    const orchestrator = createStrategyOrchestrator(target);
    for (const [event, actorType] of [
      ["START_INTAKE", "human"],
      ["SUBMIT_INTAKE", "human"],
      ["PROCESS_EVIDENCE", "system"],
      ["MARK_ANALYSIS_COMPLETE", "system"],
    ] as const) await orchestrator.transition({ businessId, event, actorType });
  }

  async function setupEvidenceReady() {
    const foundation = new FoundationRepository(database);
    const business = await new BusinessService(foundation).create({
      name: `Atomic Add Information ${randomUUID()}`,
    });
    await moveToEvidenceReady(database, business.id);
    return { business, foundation };
  }

  async function setupQuestion() {
    const context = await setupEvidenceReady();
    const snapshot = await context.foundation.createSnapshot(context.business.id);
    const [run] = await database.insert(schema.analysisRuns).values({
      businessId: context.business.id,
      inputSnapshotId: snapshot.id,
      module: "evidence_coherence",
      runType: "snapshot_analysis",
      inputProjectionVersion: "evidence_coherence_input_v1",
      inputPayload: {},
      inputHash: randomUUID(),
      promptVersion: "evidence_coherence_v1",
      provider: "test",
      modelIdentifier: "deterministic",
      modelConfiguration: {},
    }).returning();
    await database.update(schema.analysisRuns).set({
      status: "SUCCEEDED",
      structuredOutput: {},
      validationErrors: [],
      completedAt: new Date(),
    }).where(eq(schema.analysisRuns.id, run.id));
    const [gap] = await database.insert(schema.evidenceGaps).values({
      businessId: context.business.id,
      analysisRunId: run.id,
      area: "customers_and_market",
      missingInformation: "Current client count is unknown.",
      decisionImpact: "Capacity cannot be assessed.",
      materiality: "high",
      priorityRank: 1,
    }).returning();
    const [question] = await database.insert(schema.analysisQuestions).values({
      businessId: context.business.id,
      evidenceGapId: gap.id,
      question: "How many active clients are there?",
      priorityOrder: 1,
    }).returning();
    const orchestrator = createStrategyOrchestrator(database);
    await orchestrator.transition({
      businessId: context.business.id,
      event: "RUN_GAP_ANALYSIS",
      actorType: "system",
    });
    await orchestrator.transition({
      businessId: context.business.id,
      event: "MARK_ANALYSIS_COMPLETE",
      actorType: "system",
    });
    return { ...context, snapshot, run, question };
  }

  async function waitUntilLockBlocked(applicationName: string) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ blocked: boolean }>(`
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

  async function commandCounts(businessId: string) {
    const [workflow] = await database.select().from(schema.strategyWorkflows)
      .where(eq(schema.strategyWorkflows.businessId, businessId));
    const [[sources], [runs], transitions] = await Promise.all([
      database.select({ value: count() }).from(schema.sourceSubmissions)
        .where(eq(schema.sourceSubmissions.businessId, businessId)),
      database.select({ value: count() }).from(schema.evidenceExtractionRuns)
        .where(eq(schema.evidenceExtractionRuns.businessId, businessId)),
      database.select().from(schema.workflowTransitions).where(eq(
        schema.workflowTransitions.workflowId,
        workflow.id,
      )),
    ]);
    return {
      sources: sources.value,
      runs: runs.value,
      addEvidenceTransitions: transitions.filter((item) => item.event === "ADD_EVIDENCE").length,
      workflow,
    };
  }

  it("commits exactly one ordinary Add Information command under concurrent submission", async () => {
    const { business } = await setupEvidenceReady();
    const left = namedDatabase("ordinary_left");
    const right = namedDatabase("ordinary_right");
    const results = await Promise.allSettled([
      serviceFor(left.database).submit({ businessId: business.id, rawText: "First competing source" }),
      serviceFor(right.database).submit({ businessId: business.id, rawText: "Second competing source" }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await commandCounts(business.id)).toMatchObject({
      sources: 1,
      runs: 1,
      addEvidenceTransitions: 1,
      workflow: { state: "EVIDENCE_PROCESSING" },
    });
  });

  it("commits exactly one answer and leaves no orphan source under concurrent question submission", async () => {
    const { business, question } = await setupQuestion();
    const left = namedDatabase("question_left");
    const right = namedDatabase("question_right");
    const results = await Promise.allSettled([
      serviceFor(left.database).submit({
        businessId: business.id,
        questionId: question.id,
        rawText: "There are 10 active clients.",
      }),
      serviceFor(right.database).submit({
        businessId: business.id,
        questionId: question.id,
        rawText: "There are 11 active clients.",
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const [link] = await database.select().from(schema.analysisQuestionSources)
      .where(eq(schema.analysisQuestionSources.questionId, question.id));
    const [source] = await database.select().from(schema.sourceSubmissions)
      .where(eq(schema.sourceSubmissions.id, link.sourceSubmissionId));
    expect(["There are 10 active clients.", "There are 11 active clients."])
      .toContain(source.rawText);
    expect(await commandCounts(business.id)).toMatchObject({
      sources: 1,
      runs: 1,
      addEvidenceTransitions: 1,
      workflow: { state: "EVIDENCE_PROCESSING" },
    });
  });

  it("rolls back the whole Add Information command when archive owns the Business lock", async () => {
    const { business } = await setupEvidenceReady();
    const archiveClient = await pool.connect();
    const operation = namedDatabase("archive_first");
    try {
      await beginArchive(archiveClient, business.id);
      const submission = serviceFor(operation.database).submit({
        businessId: business.id,
        rawText: "This must not be stored.",
      });
      await waitUntilLockBlocked(operation.applicationName);
      await archiveClient.query("commit");
      await expect(submission).rejects.toBeInstanceOf(BusinessArchivedError);
      expect(await commandCounts(business.id)).toMatchObject({
        sources: 0,
        runs: 0,
        addEvidenceTransitions: 0,
        workflow: { state: "EVIDENCE_READY" },
      });
    } finally {
      await archiveClient.query("rollback").catch(() => undefined);
      archiveClient.release();
    }
  });

  it("preserves an Add Information command but rejects completion when a waiting archive wins next", async () => {
    const { business, foundation } = await setupEvidenceReady();
    const workflow = await foundation.getWorkflow(business.id);
    const blocker = await pool.connect();
    const operation = namedDatabase("write_first");
    const archive = namedDatabase("archive_waits");
    try {
      await blocker.query("begin");
      await blocker.query("select id from strategy_workflows where id = $1 for update", [workflow!.id]);
      const submission = serviceFor(operation.database).submit({
        businessId: business.id,
        rawText: "This source wins before archive.",
      });
      await waitUntilLockBlocked(operation.applicationName);
      const archival = new BusinessService(new FoundationRepository(archive.database))
        .archive(business.id);
      await waitUntilLockBlocked(archive.applicationName);
      await blocker.query("commit");
      await expect(submission).rejects.toThrow("This business is archived");
      await expect(archival).resolves.toMatchObject({ status: "archived" });
      expect(await commandCounts(business.id)).toMatchObject({
        sources: 1,
        runs: 1,
        addEvidenceTransitions: 1,
        workflow: { state: "EVIDENCE_PROCESSING" },
      });
      const [run] = await database.select().from(schema.evidenceExtractionRuns)
        .where(eq(schema.evidenceExtractionRuns.businessId, business.id));
      expect(run).toMatchObject({ status: "FAILED" });
      expect(await database.select().from(schema.evidenceProposals)
        .where(eq(schema.evidenceProposals.businessId, business.id))).toEqual([]);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
    }
  });
});
