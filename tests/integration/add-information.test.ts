import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe } from "vitest";
import type { Database } from "@/db/client";
import { addInformationScenarios } from "../fixtures/add-information-scenarios";

describe("Add Information", () => {
  let client: PGlite;
  let database: Database;
  beforeAll(async () => {
    client = new PGlite();
    for (const name of ["0000_furry_wolf_cub", "0001_evidence_extraction", "0002_evidence_review", "0003_business_permanent_delete", "0004_spotty_harpoon"]) {
      const migration = await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await client.exec(statement);
    }
    database = drizzle(client) as unknown as Database;
  });
  afterAll(async () => client.close());
  addInformationScenarios(() => database);
});
