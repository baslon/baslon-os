import { describe, expect, it } from "vitest";
import { claimInputSchema, evidenceInputSchema } from "@/domain/schemas";

const businessId = "550e8400-e29b-41d4-a716-446655440000";

describe("foundation schemas", () => {
  it("preserves explicit unknown claims", () => {
    const result = claimInputSchema.parse({
      businessId,
      statement: "Repeat-client revenue share is unknown.",
      claimType: "unknown",
      subjectArea: "economics",
      confidenceLevel: "high",
      sourceType: "business_intake",
    });
    expect(result.claimType).toBe("unknown");
  });

  it("does not accept an invented claim category", () => {
    expect(() => claimInputSchema.parse({
      businessId,
      statement: "This should not become a fact.",
      claimType: "verified_opinion",
      subjectArea: "offer",
      confidenceLevel: "low",
      sourceType: "ai",
    })).toThrow();
  });

  it("validates evidence dates and reliability scores", () => {
    expect(() => evidenceInputSchema.parse({
      businessId,
      evidenceType: "record",
      statement: "Invalid evidence",
      periodStart: "2026-02-01",
      periodEnd: "2026-01-01",
      sourceType: "record",
      reliabilityLevel: "low",
      reliabilityScore: 1.1,
      directnessLevel: "direct",
      recencyLevel: "recent",
      materiality: "low",
    })).toThrow();
  });
});
