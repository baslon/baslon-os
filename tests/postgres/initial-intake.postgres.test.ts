import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Database } from "@/db/client";
import { InitialIntakeUnavailableError } from "@/domain/initial-intake";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { InitialIntakeRepository } from "@/repositories/initial-intake-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { InitialIntakeService } from "@/services/initial-intake-service";
import { initialIntakeScenarios } from "../fixtures/initial-intake-scenarios";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

describe("PostgreSQL 17 initial intake", () => {
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
  initialIntakeScenarios(() => database);

  function serviceOnOwnConnection() {
    const operationPool = new Pool({ connectionString, max: 1 });
    operationPools.push(operationPool);
    const target = drizzle({ client: operationPool, schema }) as unknown as Database;
    return new InitialIntakeService(
      new InitialIntakeRepository(target),
      new EvidenceExtractionService(new EvidenceExtractionRepository(target), {
        getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
        extract: async () => ({
          output: { claims: [], evidence: [], metrics: [], relationships: [] },
          rawOutput: {},
        }),
      }),
    );
  }

  it("commits exactly one initial intake under concurrent submission from a new Business", async () => {
    const foundation = new FoundationRepository(database);
    const business = await new BusinessService(foundation).create({
      name: `Concurrent initial intake ${randomUUID()}`,
    });
    const results = await Promise.allSettled([
      serviceOnOwnConnection().submit({ businessId: business.id, rawIntakeText: "First intake" }),
      serviceOnOwnConnection().submit({ businessId: business.id, rawIntakeText: "Second intake" }),
    ]);
    const rejected = results.filter((item) => item.status === "rejected");
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InitialIntakeUnavailableError);

    const workflow = await foundation.getWorkflow(business.id);
    const transitions = await foundation.getTransitionHistory(workflow!.id);
    const runs = await database.select().from(schema.evidenceExtractionRuns)
      .where(eq(schema.evidenceExtractionRuns.businessId, business.id));
    expect(workflow?.state).toBe("EVIDENCE_PROCESSING");
    expect(transitions.map((item) => item.event))
      .toEqual(["START_INTAKE", "SUBMIT_INTAKE", "PROCESS_EVIDENCE"]);
    expect(runs).toHaveLength(1);
  });
});
