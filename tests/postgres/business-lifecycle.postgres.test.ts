import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { claims, evidence, metrics } from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { baslonClaims, baslonEvidence, baslonMetric } from "../fixtures/baslon-business";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required for real PostgreSQL verification");

describe("real PostgreSQL 17 Business Archive and Restore", () => {
  let pool: Pool;
  let database: Database;
  let foundation: FoundationRepository;
  let service: BusinessService;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    database = drizzle({ client: pool });
    foundation = new FoundationRepository(database);
    service = new BusinessService(foundation);
    const result = await database.execute<{ server_version_num: string }>(sql`show server_version_num`);
    expect(Number(result.rows[0].server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(result.rows[0].server_version_num)).toBeLessThan(180000);
  });

  afterAll(async () => pool.end());

  it("preserves canonical data across idempotent archive and restore", async () => {
    const business = await service.create({ name: `PostgreSQL lifecycle ${randomUUID()}` });
    const claim = await foundation.addClaim(baslonClaims(business.id)[0]);
    const evidenceItem = await foundation.addEvidence(baslonEvidence(business.id));
    await foundation.addMetric(baslonMetric(business.id, evidenceItem.id));
    const canonicalCounts = async () => Promise.all([
      database.select({ value: count() }).from(claims).where(eq(claims.businessId, business.id)),
      database.select({ value: count() }).from(evidence).where(eq(evidence.businessId, business.id)),
      database.select({ value: count() }).from(metrics).where(eq(metrics.businessId, business.id)),
    ]).then((results) => results.map(([result]) => result.value));
    const before = await canonicalCounts();

    const archived = await service.archive(business.id);
    const repeated = await service.archive(business.id);
    expect(repeated.archivedAt?.getTime()).toBe(archived.archivedAt?.getTime());
    expect(repeated.updatedAt.getTime()).toBe(archived.updatedAt.getTime());
    expect(await canonicalCounts()).toEqual(before);
    expect((await service.list()).map((item) => item.id)).not.toContain(business.id);
    expect((await service.listArchived()).map((item) => item.id)).toContain(business.id);

    const restored = await service.restore(business.id);
    const repeatedRestore = await service.restore(business.id);
    expect(restored).toMatchObject({ id: business.id, status: "active", archivedAt: null });
    expect(repeatedRestore.updatedAt.getTime()).toBe(restored.updatedAt.getTime());
    expect(await canonicalCounts()).toEqual(before);
    expect(claim.businessId).toBe(business.id);
  });

  it("rejects workflow progression while archived without changing workflow history", async () => {
    const business = await service.create({ name: `PostgreSQL archived workflow ${randomUUID()}` });
    const workflow = await foundation.getWorkflow(business.id);
    await service.archive(business.id);
    await expect(createStrategyOrchestrator(database).transition({
      businessId: business.id,
      event: "START_INTAKE",
      actorType: "human",
      actorId: "postgres-lifecycle-test",
    })).rejects.toThrow("archived");
    expect(await foundation.getWorkflow(business.id)).toMatchObject({ state: "NEW", version: 1 });
    expect(await foundation.getTransitionHistory(workflow!.id)).toHaveLength(0);
  });
});
