import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe } from "vitest";
import type { Database } from "@/db/client";
import { initialIntakeScenarios } from "../fixtures/initial-intake-scenarios";

describe("Initial intake", () => {
  let client: PGlite;
  let database: Database;
  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    database = drizzle(client) as unknown as Database;
  }, 30_000);
  afterAll(async () => client.close());
  initialIntakeScenarios(() => database);
});
