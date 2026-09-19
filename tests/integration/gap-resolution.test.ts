import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe } from "vitest";
import type { Database } from "@/db/client";
import { gapResolutionScenarios } from "../fixtures/gap-resolution-scenarios";

describe("Gap resolution and Phase 1 entry", () => {
  let client: PGlite;
  let database: Database;
  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    database = drizzle(client) as unknown as Database;
  }, 30_000);
  afterAll(async () => client.close());
  gapResolutionScenarios(() => database);
});
