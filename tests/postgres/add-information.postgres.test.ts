import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll, describe, expect } from "vitest";
import { addInformationScenarios } from "../fixtures/add-information-scenarios";
import * as schema from "@/db/schema";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/baslon_os_test") {
  throw new Error("Add Information PostgreSQL tests require baslon_os_test.");
}
describe("PostgreSQL 17 Add Information", () => {
  const pool = new Pool({ connectionString });
  const database = drizzle({ client: pool, schema });
  beforeAll(async () => {
    const result = await pool.query("select current_database() as name, current_setting('server_version_num')::int as version");
    expect(result.rows[0].name).toBe("baslon_os_test");
    expect(result.rows[0].version).toBeGreaterThanOrEqual(170000);
    expect(result.rows[0].version).toBeLessThan(180000);
  });
  afterAll(async () => pool.end());
  addInformationScenarios(() => database);
});
