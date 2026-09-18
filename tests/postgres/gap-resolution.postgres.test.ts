import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { BusinessArchivedError } from "@/repositories/business-lifecycle-guard";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { GapResolutionService } from "@/services/gap-resolution-service";
import {
  createGapResolutionContext,
  gapResolutionScenarios,
} from "../fixtures/gap-resolution-scenarios";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

describe("PostgreSQL 17 gap resolution and Phase 1 entry", () => {
  const pool = new Pool({ connectionString, max: 10 });
  const database = drizzle({ client: pool, schema }) as unknown as Database;
  const operationPools: Pool[] = [];
  beforeAll(async () => {
    await verifyPostgresTestDatabase(pool);
  });
  afterEach(async () => {
    await Promise.all(operationPools.splice(0).map((item) => item.end()));
  });
  afterAll(async () => pool.end());
  gapResolutionScenarios(() => database);

  function gapServiceOnOwnConnection(label: string) {
    const applicationName = `baslon_gap_${label}_${randomUUID().slice(0, 8)}`;
    const operationPool = new Pool({ connectionString, application_name: applicationName, max: 1 });
    operationPools.push(operationPool);
    const target = drizzle({ client: operationPool, schema }) as unknown as Database;
    return {
      applicationName,
      service: new GapResolutionService(new EvidenceCoherenceRepository(target), createStrategyOrchestrator(target)),
    };
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

  it("commits exactly one CONTINUE_WITH_GAPS under concurrent requests", async () => {
    const c = await createGapResolutionContext(database, "none");
    const before = await c.state();
    const results = await Promise.allSettled([
      gapServiceOnOwnConnection("left").service.continueWithGaps({ businessId: c.business.id }),
      gapServiceOnOwnConnection("right").service.continueWithGaps({ businessId: c.business.id }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const after = await c.state();
    expect(after.workflow).toMatchObject({ state: "PHASE1_READY", version: before.workflow!.version + 1 });
    expect(after.transitions.filter((item) => item.event === "CONTINUE_WITH_GAPS")).toHaveLength(1);
  });

  it("re-checks the snapshot precondition inside the transition transaction", async () => {
    const c = await createGapResolutionContext(database, "none");
    const before = await c.state();
    const lockHolder = await pool.connect();
    try {
      // Hold the Business lock while a newer snapshot is written, as review completion does.
      await lockHolder.query("begin");
      await lockHolder.query("select id from businesses where id = $1 for update", [c.business.id]);
      await lockHolder.query(`
        insert into business_state_snapshots (business_id, version, snapshot_data)
        select $1, max(version) + 1, '{}'::jsonb from business_state_snapshots where business_id = $1
      `, [c.business.id]);

      // The service reads the old latest snapshot, then its transition waits for the Business lock.
      const operation = gapServiceOnOwnConnection("snapshot_race");
      const continuing = operation.service.continueWithGaps({ businessId: c.business.id })
        .then(() => undefined, (error: unknown) => error);
      await waitUntilLockBlocked(operation.applicationName);
      await lockHolder.query("commit");

      expect(await continuing).toEqual(expect.objectContaining({
        message: "Continuing with gaps must use the latest canonical snapshot",
      }));
    } finally {
      await lockHolder.query("rollback").catch(() => undefined);
      lockHolder.release();
    }
    expect(await c.state()).toEqual(before);
  });

  it("rejects CONTINUE_WITH_GAPS when archive wins the Business lock", async () => {
    const c = await createGapResolutionContext(database, "none");
    const before = await c.state();
    const archive = await pool.connect();
    try {
      await archive.query("begin");
      await archive.query(
        "update businesses set status = 'archived', archived_at = now(), updated_at = now() where id = $1",
        [c.business.id],
      );
      const operation = gapServiceOnOwnConnection("archive_race");
      const continuing = operation.service.continueWithGaps({ businessId: c.business.id })
        .then(() => undefined, (error: unknown) => error);
      await waitUntilLockBlocked(operation.applicationName);
      await archive.query("commit");
      expect(await continuing).toBeInstanceOf(BusinessArchivedError);
    } finally {
      await archive.query("rollback").catch(() => undefined);
      archive.release();
    }
    expect(await c.state()).toEqual(before);
  });
});
