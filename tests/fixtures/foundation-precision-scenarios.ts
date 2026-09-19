import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { FoundationRepository } from "@/repositories/foundation-repository";
import { baslonEvidence, baslonMetric } from "./baslon-business";

/**
 * Foundation canonical writes (FoundationRepository.addEvidence/addMetric) must
 * persist supplied precision and range bounds, and default to `unspecified`
 * only when a caller supplies none. Shared by PGlite and PostgreSQL suites.
 */
export function foundationPrecisionScenarios(repository: () => FoundationRepository) {
  const newBusiness = () => repository().createBusiness({ name: `Foundation precision ${randomUUID()}` });
  // The shared fixture Evidence is qualitative; give it a single numeric value here.
  const numericEvidence = (businessId: string) => ({ ...baslonEvidence(businessId), valueNumeric: 3200, unit: "GBP" });

  it.each(["exact", "approximate", "estimate"] as const)(
    "persists %s precision through Foundation Evidence and Metric writes",
    async (precision) => {
      const business = await newBusiness();
      const item = await repository().addEvidence({ ...numericEvidence(business.id), valuePrecision: precision });
      const metric = await repository().addMetric({ ...baslonMetric(business.id, item.id), numericPrecision: precision });
      expect(item).toMatchObject({ valueNumeric: "3200.0000", valuePrecision: precision, valueLower: null, valueUpper: null });
      expect(metric).toMatchObject({ numericValue: "3200.0000", numericPrecision: precision, numericLower: null, numericUpper: null });
    },
  );

  it("persists a range with both bounds and no single value through Foundation writes", async () => {
    const business = await newBusiness();
    const item = await repository().addEvidence({
      ...baslonEvidence(business.id), valueNumeric: undefined,
      valuePrecision: "range", valueLower: 1000, valueUpper: 6000,
    });
    const metric = await repository().addMetric({
      ...baslonMetric(business.id, item.id), numericValue: undefined,
      numericPrecision: "range", numericLower: 1000, numericUpper: 6000,
    });
    expect(item).toMatchObject({ valueNumeric: null, valuePrecision: "range", valueLower: "1000.0000", valueUpper: "6000.0000" });
    expect(metric).toMatchObject({ numericValue: null, numericPrecision: "range", numericLower: "1000.0000", numericUpper: "6000.0000" });
    const snapshot = await repository().createSnapshot(business.id);
    const data = snapshot.snapshotData as { evidence: Array<Record<string, unknown>>; metrics: Array<Record<string, unknown>> };
    expect(data.evidence).toEqual([expect.objectContaining({ id: item.id, valuePrecision: "range", valueLower: "1000.0000" })]);
    expect(data.metrics).toEqual([expect.objectContaining({ id: metric.id, numericPrecision: "range", numericUpper: "6000.0000" })]);
  });

  it("stores unspecified when a Foundation caller supplies no precision", async () => {
    const business = await newBusiness();
    const item = await repository().addEvidence(numericEvidence(business.id));
    const metric = await repository().addMetric(baslonMetric(business.id, item.id));
    const qualitative = await repository().addEvidence(baslonEvidence(business.id));
    expect(item).toMatchObject({ valueNumeric: "3200.0000", valuePrecision: "unspecified", valueLower: null, valueUpper: null });
    expect(qualitative).toMatchObject({ valueNumeric: null, valuePrecision: "unspecified", valueLower: null, valueUpper: null });
    expect(metric).toMatchObject({ numericValue: "3200.0000", numericPrecision: "unspecified", numericLower: null, numericUpper: null });
  });

  it("rejects malformed precision shapes before writing", async () => {
    const business = await newBusiness();
    const evidenceInput = numericEvidence(business.id);
    for (const invalid of [
      { valuePrecision: "range" as const, valueLower: 6000, valueUpper: 1000, valueNumeric: undefined },
      { valuePrecision: "range" as const, valueLower: 1000, valueUpper: 6000 },
      { valuePrecision: "exact" as const, valueNumeric: undefined },
      { valuePrecision: "approximate" as const, valueLower: 1000, valueUpper: 6000 },
      { valuePrecision: "precise" as never },
    ]) {
      await expect(repository().addEvidence({ ...evidenceInput, ...invalid })).rejects.toThrow();
    }
    const item = await repository().addEvidence(evidenceInput);
    for (const invalid of [
      { numericValue: undefined },
      { numericPrecision: "range" as const, numericLower: 1000, numericUpper: 6000 },
      { numericPrecision: "estimate" as const, numericValue: undefined },
    ]) {
      await expect(repository().addMetric({ ...baslonMetric(business.id, item.id), ...invalid })).rejects.toThrow();
    }
  });
}
