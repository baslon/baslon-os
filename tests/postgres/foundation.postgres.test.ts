import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  claimEvidence,
  claims,
  metrics,
} from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { baslonClaims, baslonEvidence } from "../fixtures/baslon-business";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for real PostgreSQL verification");
}

describe("real PostgreSQL 17 foundation verification", () => {
  let pool: Pool;
  let database: Database;
  let repository: FoundationRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    database = drizzle({ client: pool });
    repository = new FoundationRepository(database);
    const result = await database.execute<{ server_version_num: string }>(
      sql`show server_version_num`,
    );
    expect(Number(result.rows[0].server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(result.rows[0].server_version_num)).toBeLessThan(180000);
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
