import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll, describe } from "vitest";
import { addInformationScenarios } from "../fixtures/add-information-scenarios";
import * as schema from "@/db/schema";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();
describe("PostgreSQL 17 Add Information", () => {
  const pool = new Pool({ connectionString });
  const database = drizzle({ client: pool, schema });
  beforeAll(async () => {
    await verifyPostgresTestDatabase(pool);
  });
  afterAll(async () => pool.end());
  addInformationScenarios(() => database);
});
