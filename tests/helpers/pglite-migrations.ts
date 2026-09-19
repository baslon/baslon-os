import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";

type Journal = { entries: { idx: number; tag: string }[] };

/**
 * Applies every Drizzle migration listed in the journal, in order, so PGlite
 * integration tests always run against the same schema as PostgreSQL.
 */
export async function applyMigrations(client: PGlite): Promise<void> {
  await client.waitReady;
  const journal = JSON.parse(
    await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as Journal;
  for (const { tag } of journal.entries.toSorted((left, right) => left.idx - right.idx)) {
    const migration = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}
