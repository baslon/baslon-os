import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  POSTGRES_TEST_DATABASE_NAME,
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

describe("PostgreSQL test database guard", () => {
  it("rejects a development-database URL before any caller can connect or mutate", () => {
    let connectionAttempted = false;

    expect(() => {
      requirePostgresTestDatabaseUrl(
        "postgresql://test-user:test-password@localhost:5432/baslon_os",
      );
      connectionAttempted = true;
    }).toThrow(`PostgreSQL tests require ${POSTGRES_TEST_DATABASE_NAME}`);
    expect(connectionAttempted).toBe(false);
  });

  it("accepts only the exact test database name", () => {
    const value = "postgresql://test-user:test-password@localhost:5432/baslon_os_test";
    expect(requirePostgresTestDatabaseUrl(value)).toBe(value);
    // Independent of the caller's environment, which sets TEST_DATABASE_URL for the PostgreSQL suite.
    vi.stubEnv("TEST_DATABASE_URL", "");
    try {
      expect(() => requirePostgresTestDatabaseUrl()).toThrow("TEST_DATABASE_URL");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a connection that resolves to another database", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ name: "baslon_os", version: 170011 }],
    });

    await expect(verifyPostgresTestDatabase({ query } as unknown as Pool))
      .rejects.toThrow(`expected ${POSTGRES_TEST_DATABASE_NAME}`);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("current_database()"));
  });
});
