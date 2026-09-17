import type { Pool } from "pg";

export const POSTGRES_TEST_DATABASE_NAME = "baslon_os_test";

export function requirePostgresTestDatabaseUrl(
  value = process.env.TEST_DATABASE_URL,
): string {
  if (!value) {
    throw new Error("PostgreSQL tests require TEST_DATABASE_URL.");
  }

  let targetDatabase: string;
  try {
    targetDatabase = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  } catch {
    throw new Error("PostgreSQL tests require a valid TEST_DATABASE_URL.");
  }

  if (targetDatabase !== POSTGRES_TEST_DATABASE_NAME) {
    throw new Error(
      `PostgreSQL tests require ${POSTGRES_TEST_DATABASE_NAME}; received ${targetDatabase || "no database"}.`,
    );
  }

  return value;
}

export async function verifyPostgresTestDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{
    name: string;
    version: number;
  }>(
    "select current_database() as name, current_setting('server_version_num')::int as version",
  );
  const connection = result.rows[0];

  if (connection?.name !== POSTGRES_TEST_DATABASE_NAME) {
    throw new Error(
      `PostgreSQL tests connected to ${connection?.name || "an unknown database"}; expected ${POSTGRES_TEST_DATABASE_NAME}.`,
    );
  }
  if (connection.version < 170000 || connection.version >= 180000) {
    throw new Error("PostgreSQL tests require PostgreSQL 17.x.");
  }
}
