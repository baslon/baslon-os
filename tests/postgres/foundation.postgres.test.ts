import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import {
  claimEvidence,
  claims,
  businessProfiles,
  metrics,
} from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { baslonClaims, baslonEvidence } from "../fixtures/baslon-business";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

describe("real PostgreSQL 17 foundation verification", () => {
  let pool: Pool;
  let database: Database;
  let repository: FoundationRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
    repository = new FoundationRepository(database);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("serializes snapshot versions across independent pool connections", async () => {
    const business = await repository.createBusiness({
      name: `PostgreSQL snapshot test ${randomUUID()}`,
    });
    const snapshots = await Promise.all([
      repository.createSnapshot(business.id),
      repository.createSnapshot(business.id),
    ]);
    expect(snapshots.map((item) => item.version).sort()).toEqual([1, 2]);
  });

  it("commits exactly one competing workflow transition", async () => {
    const business = await repository.createBusiness({
      name: `PostgreSQL workflow test ${randomUUID()}`,
    });
    const orchestrator = createStrategyOrchestrator(database);
    const results = await Promise.allSettled([1, 2].map(() => orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
      actorId: "postgres-test-owner",
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const workflow = await repository.getWorkflow(business.id);
    expect(await repository.getTransitionHistory(workflow!.id)).toHaveLength(1);
  });

  it("enforces an event-specific artifact precondition before PostgreSQL mutation", async () => {
    const business = await repository.createBusiness({
      name: `PostgreSQL workflow precondition ${randomUUID()}`,
    });
    const orchestrator = createStrategyOrchestrator(database, {
      START_INTAKE: async ({ database: transaction, businessId }) => {
        const [artifact] = await transaction.select({ id: claims.id }).from(claims)
          .where(eq(claims.businessId, businessId));
        if (!artifact) throw new Error("required artifact missing");
      },
    });
    await expect(orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
    })).rejects.toThrow("required artifact missing");
    const before = await repository.getWorkflow(business.id);
    expect(before?.state).toBe("NEW");
    expect(await repository.getTransitionHistory(before!.id)).toHaveLength(0);
    await repository.addClaim(baslonClaims(business.id)[0]);
    await orchestrator.transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
    });
    expect((await repository.getWorkflow(business.id))?.state).toBe("INTAKE_IN_PROGRESS");
  });

  it("keeps artifact validation and workflow persistence in one lock boundary", async () => {
    const business = await repository.createBusiness({
      name: `PostgreSQL workflow artifact race ${randomUUID()}`,
    });
    const transitionPool = new Pool({
      connectionString,
      application_name: `baslon_precondition_transition_${randomUUID().slice(0, 8)}`,
      max: 1,
    });
    const invalidationName = `baslon_precondition_invalidation_${randomUUID().slice(0, 8)}`;
    const invalidationPool = new Pool({
      connectionString,
      application_name: invalidationName,
      max: 1,
    });
    let releaseValidation!: () => void;
    let validationReached!: () => void;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const validated = new Promise<void>((resolve) => { validationReached = resolve; });
    const transitionDatabase = drizzle({ client: transitionPool, schema });
    const orchestrator = createStrategyOrchestrator(transitionDatabase, {
      START_INTAKE: async ({ database: transaction, businessId }) => {
        const [artifact] = await transaction.select({ businessId: businessProfiles.businessId })
          .from(businessProfiles)
          .where(eq(businessProfiles.businessId, businessId))
          .for("key share");
        if (!artifact) throw new Error("required artifact missing");
        validationReached();
        await validationGate;
      },
    });
    try {
      const transition = orchestrator.transition({
        businessId: business.id,
        event: "START_INTAKE",
        actorType: "human",
      });
      await validated;
      await invalidationPool.query("begin");
      const invalidation = invalidationPool.query(
        "delete from business_profiles where business_id = $1",
        [business.id],
      );
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const result = await pool.query<{ blocked: boolean }>(`
          select exists (
            select 1 from pg_stat_activity
            where application_name = $1 and wait_event_type = 'Lock'
          ) as blocked
        `, [invalidationName]);
        if (result.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      releaseValidation();
      await expect(transition).resolves.toMatchObject({ state: "INTAKE_IN_PROGRESS" });
      await invalidation;
      await invalidationPool.query("rollback");
      const workflow = await repository.getWorkflow(business.id);
      expect(workflow?.state).toBe("INTAKE_IN_PROGRESS");
      expect(await repository.getTransitionHistory(workflow!.id)).toHaveLength(1);
    } finally {
      releaseValidation();
      await invalidationPool.query("rollback").catch(() => undefined);
      await Promise.all([transitionPool.end(), invalidationPool.end()]);
    }
  });

  it("rolls workflow state back when history insertion fails", async () => {
    const business = await repository.createBusiness({
      name: `PostgreSQL rollback test ${randomUUID()}`,
    });
    const triggerName = `fail_history_${randomUUID().replaceAll("-", "")}`;
    await database.execute(sql.raw(`
      CREATE FUNCTION ${triggerName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced history failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON workflow_transitions
      FOR EACH ROW EXECUTE FUNCTION ${triggerName}();
    `));
    try {
      await expect(createStrategyOrchestrator(database).transition({
        businessId: business.id,
        event: "START_INTAKE",
        actorType: "human",
        actorId: "postgres-test-owner",
      })).rejects.toThrow();
      expect((await repository.getWorkflow(business.id))?.state).toBe("NEW");
    } finally {
      await database.execute(sql.raw(`
        DROP TRIGGER ${triggerName} ON workflow_transitions;
        DROP FUNCTION ${triggerName}();
      `));
    }
  });

  it("rejects cross-Business relationships using PostgreSQL constraints", async () => {
    const first = await repository.createBusiness({ name: `PG A ${randomUUID()}` });
    const second = await repository.createBusiness({ name: `PG B ${randomUUID()}` });
    const firstClaim = await repository.addClaim(baslonClaims(first.id)[0]);
    const secondClaim = await repository.addClaim(baslonClaims(second.id)[0]);
    const secondEvidence = await repository.addEvidence(baslonEvidence(second.id));

    await expect(database.insert(claimEvidence).values({
      businessId: first.id,
      claimId: firstClaim.id,
      evidenceId: secondEvidence.id,
      relationshipType: "supports",
    })).rejects.toThrow();
    await expect(database.insert(metrics).values({
      businessId: first.id,
      metricKey: "cross_business",
      metricLabel: "Cross-Business",
      numericValue: "1",
      unit: "count",
      sourceEvidenceId: secondEvidence.id,
    })).rejects.toThrow();
    await expect(database.update(claims)
      .set({ supersededByClaimId: secondClaim.id })
      .where(eq(claims.id, firstClaim.id))).rejects.toThrow();
  });
});
