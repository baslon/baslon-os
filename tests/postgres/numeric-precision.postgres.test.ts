import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { businesses, businessStateSnapshots, evidence, metrics } from "@/db/schema";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { BusinessService } from "@/services/business-service";
import { baslonEvidence, baslonMetric } from "../fixtures/baslon-business";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";
import { foundationPrecisionScenarios } from "../fixtures/foundation-precision-scenarios";

const connectionString = requirePostgresTestDatabaseUrl();

describe("real PostgreSQL 17 numeric precision (M4-02A)", () => {
  let pool: Pool;
  let database: Database;
  let foundation: FoundationRepository;
  let service: BusinessService;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
    foundation = new FoundationRepository(database);
    service = new BusinessService(foundation, new BusinessDeletionRepository(database));
  });

  afterAll(async () => pool.end());

  foundationPrecisionScenarios(() => foundation);

  const newBusiness = () => service.create({ name: `Numeric precision test ${randomUUID()}` });
  // Direct inserts exercise the database constraints themselves.
  type EvidenceRow = typeof evidence.$inferInsert;
  type MetricRow = typeof metrics.$inferInsert;
  const insertEvidence = async (businessId: string, overrides: Partial<EvidenceRow> = {}) => {
    const base = baslonEvidence(businessId);
    const [row] = await database.insert(evidence).values({
      ...base, reliabilityScore: base.reliabilityScore?.toString(), valueNumeric: "80000",
      valueLower: base.valueLower?.toString(), valueUpper: base.valueUpper?.toString(), ...overrides,
    }).returning();
    return row;
  };
  const insertMetric = async (businessId: string, sourceEvidenceId: string, overrides: Partial<MetricRow> = {}) => {
    const base = baslonMetric(businessId, sourceEvidenceId);
    const [row] = await database.insert(metrics).values({
      ...base, numericValue: "80000",
      numericLower: base.numericLower?.toString(), numericUpper: base.numericUpper?.toString(), ...overrides,
    }).returning();
    return row;
  };

  // Asserts the database itself refused the row, naming the violated constraint.
  const violates = async (promise: Promise<unknown>, constraint: string) => {
    const error = await promise.then(() => undefined, (caught: unknown) => caught as { cause?: { constraint?: string } });
    expect(error?.cause?.constraint).toBe(constraint);
  };

  it("defaults rows written without precision to unspecified and never to exact", async () => {
    const business = await newBusiness();
    // Written exactly as pre-M4-02A code did: no precision columns supplied.
    const item = await foundation.addEvidence(baslonEvidence(business.id));
    const metric = await foundation.addMetric(baslonMetric(business.id, item.id));
    expect(item).toMatchObject({ valuePrecision: "unspecified", valueLower: null, valueUpper: null });
    expect(metric).toMatchObject({ numericPrecision: "unspecified", numericLower: null, numericUpper: null });
  });

  it("persists scalar precision and range bounds and includes them in a new snapshot", async () => {
    const business = await newBusiness();
    const approximate = await insertEvidence(business.id, { valuePrecision: "approximate" });
    const range = await insertEvidence(business.id, { statement: "10–15 projects a year", unit: "projects",
      valueNumeric: null, valuePrecision: "range", valueLower: "10", valueUpper: "15" });
    const rangeMetric = await insertMetric(business.id, range.id, { metricKey: "annual_projects", unit: "projects",
      numericValue: null, numericPrecision: "range", numericLower: "10", numericUpper: "15" });
    expect(approximate).toMatchObject({ valueNumeric: "80000.0000", valuePrecision: "approximate" });
    expect(range).toMatchObject({ valueNumeric: null, valueLower: "10.0000", valueUpper: "15.0000" });
    expect(rangeMetric).toMatchObject({ numericValue: null, numericLower: "10.0000", numericUpper: "15.0000" });

    const snapshot = await foundation.createSnapshot(business.id);
    const data = snapshot.snapshotData as { evidence: Array<Record<string, unknown>>; metrics: Array<Record<string, unknown>> };
    expect(data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: approximate.id, valuePrecision: "approximate" }),
      expect.objectContaining({ id: range.id, valuePrecision: "range", valueLower: "10.0000", valueUpper: "15.0000" }),
    ]));
    expect(data.metrics).toEqual([expect.objectContaining({ id: rangeMetric.id, numericPrecision: "range", numericValue: null })]);
  });

  it("leaves historical snapshot JSON unchanged", async () => {
    const business = await newBusiness();
    await foundation.addEvidence(baslonEvidence(business.id));
    const snapshot = await foundation.createSnapshot(business.id);
    // Simulate a pre-M4-02A snapshot row: its JSON has no precision keys.
    const legacyData = { ...snapshot.snapshotData, evidence: [{ id: randomUUID(), statement: "Legacy", valueNumeric: "80000.0000" }] };
    await expect(database.update(businessStateSnapshots).set({ snapshotData: legacyData })
      .where(eq(businessStateSnapshots.id, snapshot.id))).rejects.toThrow();
    const [stored] = await database.select().from(businessStateSnapshots).where(eq(businessStateSnapshots.id, snapshot.id));
    expect(stored.snapshotData).toEqual(snapshot.snapshotData);
  });

  it("rejects invalid precision vocabulary at the database boundary", async () => {
    const business = await newBusiness();
    await expect(pool.query(
      `insert into evidence (business_id, evidence_type, statement, value_numeric, value_precision, source_type, reliability_level, reliability_score, directness_level, recency_level, materiality)
       values ($1, 'management_record', 'x', 1, 'precise', 'business_intake', 'medium', 0.5, 'direct', 'recent', 'low')`,
      [business.id],
    )).rejects.toThrow(/invalid input value for enum numeric_precision/);
  });

  it.each([
    ["range without bounds", { valueNumeric: null, valuePrecision: "range" as const }],
    ["range with lower above upper", { valueNumeric: null, valuePrecision: "range" as const, valueLower: "15", valueUpper: "10" }],
    ["range that also has a single value", { valueNumeric: "12", valuePrecision: "range" as const, valueLower: "10", valueUpper: "15" }],
    ["exact value with bounds", { valuePrecision: "exact" as const, valueLower: "10", valueUpper: "15" }],
    ["exact precision without a value", { valueNumeric: null, valuePrecision: "exact" as const }],
  ])("rejects Evidence with %s", async (_label, overrides) => {
    const business = await newBusiness();
    await violates(insertEvidence(business.id, overrides), "evidence_value_precision_check");
  });

  it.each([
    ["no value and no range", { numericValue: null }],
    ["range with lower above upper", { numericValue: null, numericPrecision: "range" as const, numericLower: "15", numericUpper: "10" }],
    ["range that also has a single value", { numericPrecision: "range" as const, numericLower: "10", numericUpper: "15" }],
    ["approximate value with bounds", { numericPrecision: "approximate" as const, numericLower: "10", numericUpper: "15" }],
  ])("rejects a Metric with %s", async (_label, overrides) => {
    const business = await newBusiness();
    const item = await foundation.addEvidence(baslonEvidence(business.id));
    await violates(insertMetric(business.id, item.id, overrides), "metrics_numeric_precision_check");
  });

  it("keeps same-Business integrity for range Metrics", async () => {
    const owner = await newBusiness();
    const other = await newBusiness();
    const item = await foundation.addEvidence(baslonEvidence(owner.id));
    await violates(
      insertMetric(other.id, item.id, { numericValue: null, numericPrecision: "range", numericLower: "10", numericUpper: "15" }),
      "metrics_source_evidence_same_business_fk",
    );
  });

  it("permanently deletes a Business holding precise, approximate and range records", async () => {
    const business = await newBusiness();
    const range = await insertEvidence(business.id, { valueNumeric: null, valuePrecision: "range", valueLower: "10", valueUpper: "15" });
    await insertEvidence(business.id, { valuePrecision: "approximate" });
    await insertMetric(business.id, range.id, { numericValue: null, numericPrecision: "range", numericLower: "10", numericUpper: "15" });
    await foundation.createSnapshot(business.id);
    await service.archive(business.id);
    await service.permanentlyDelete({ businessId: business.id, confirmation: business.name });
    for (const table of [evidence, metrics, businessStateSnapshots] as const) {
      const [row] = await database.select({ value: count() }).from(table).where(eq(table.businessId, business.id));
      expect(row.value).toBe(0);
    }
    const [root] = await database.select({ value: count() }).from(businesses).where(eq(businesses.id, business.id));
    expect(root.value).toBe(0);
  });

  it("reports the migrated constraints", async () => {
    const result = await database.execute(sql`
      select conname from pg_constraint
      where conname in ('evidence_value_precision_check', 'metrics_numeric_precision_check') order by conname`);
    expect(result.rows.map((row) => row.conname)).toEqual([
      "evidence_value_precision_check", "metrics_numeric_precision_check",
    ]);
  });
});
