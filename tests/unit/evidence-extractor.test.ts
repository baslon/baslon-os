import { describe, expect, it } from "vitest";
import {
  evidenceExtractionInputSchema,
  evidenceExtractionOutputSchema,
} from "@/ai/evidence-extractor/contracts";
import { validateEvidenceExtractionOutput } from "@/ai/evidence-extractor/validation";
import {
  baslonExtractionOutput,
  baslonMessyIntake,
} from "../fixtures/baslon-business";

function outputWith(mutator: (output: Record<string, unknown>) => void): unknown {
  const output = structuredClone(baslonExtractionOutput) as unknown as Record<string, unknown>;
  mutator(output);
  return output;
}

describe("Evidence Extractor contracts and business rules", () => {
  it("accepts valid internally consistent proposals", () => {
    const output = validateEvidenceExtractionOutput(
      baslonExtractionOutput,
      baslonMessyIntake,
    );
    expect(output).toMatchObject({
      claims: expect.any(Array),
      evidence: expect.any(Array),
      metrics: expect.any(Array),
      relationships: expect.any(Array),
    });
  });

  it("preserves explicit unknown information", () => {
    const output = validateEvidenceExtractionOutput(
      baslonExtractionOutput,
      baslonMessyIntake,
    );
    expect(output.claims.find((claim) => claim.proposalRef === "claim_3"))
      .toMatchObject({ claimType: "unknown" });
  });

  it.each(["fact", "decision"])("rejects the prohibited %s Claim type", (claimType) => {
    const output = outputWith((value) => {
      (value.claims as Array<Record<string, unknown>>)[0].claimType = claimType;
    });
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
  });

  it("rejects an unknown Claim category", () => {
    const output = outputWith((value) => {
      (value.claims as Array<Record<string, unknown>>)[0].claimType = "opinion";
    });
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
  });

  it("rejects an invalid relationship type", () => {
    const output = outputWith((value) => {
      (value.relationships as Array<Record<string, unknown>>)[0].relationshipType = "proves";
    });
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
  });

  it("rejects a relationship referencing nonexistent Evidence", () => {
    const output = outputWith((value) => {
      (value.relationships as Array<Record<string, unknown>>)[0].evidenceRef = "evidence_missing";
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .toThrow("references missing Evidence");
  });

  it("rejects a Metric referencing nonexistent source Evidence", () => {
    const output = outputWith((value) => {
      (value.metrics as Array<Record<string, unknown>>)[0].sourceEvidenceRef = "evidence_missing";
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .toThrow("references missing Evidence");
  });

  it("rejects malformed model output and unknown top-level structures", () => {
    expect(() => evidenceExtractionOutputSchema.parse("not-json")).toThrow();
    expect(() => evidenceExtractionOutputSchema.parse({
      ...baslonExtractionOutput,
      diagnosis: "invented",
    })).toThrow();
  });

  it("rejects out-of-range scores", () => {
    const output = outputWith((value) => {
      (value.evidence as Array<Record<string, unknown>>)[0].reliabilityScore = 1.1;
    });
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
  });

  it("rejects invented source excerpts", () => {
    const output = outputWith((value) => {
      (value.evidence as Array<Record<string, unknown>>)[0].sourceExcerpt = "invented source";
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .toThrow("not present in the intake");
  });

  it("accepts an exact numeric match", () => {
    const output = outputWith((value) => {
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      metric.numericValue = 12;
      metric.sourceExcerpt = "12 serious opportunities";
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .not.toThrow();
  });

  it("normalizes currency symbols and thousands separators", () => {
    const rawIntakeText = "Revenue was explicitly recorded as £80,000.";
    const output = outputWith((value) => {
      const item = (value.evidence as Array<Record<string, unknown>>)[0];
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      item.sourceExcerpt = "£80,000";
      item.valueNumeric = 80000;
      metric.sourceExcerpt = "£80,000";
      metric.numericValue = 80000;
    });
    expect(() => validateEvidenceExtractionOutput(output, rawIntakeText)).not.toThrow();
  });

  it("normalizes unambiguous k and currency-qualified m shorthand", () => {
    const kOutput = outputWith((value) => {
      const item = (value.evidence as Array<Record<string, unknown>>)[0];
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      item.sourceExcerpt = "80k";
      item.valueNumeric = 80000;
      metric.sourceExcerpt = "80k";
      metric.numericValue = 80000;
    });
    expect(() => validateEvidenceExtractionOutput(kOutput, "Revenue was 80k."))
      .not.toThrow();

    const mOutput = outputWith((value) => {
      const item = (value.evidence as Array<Record<string, unknown>>)[0];
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      item.sourceExcerpt = "£1.8m";
      item.valueNumeric = 1800000;
      metric.sourceExcerpt = "£1.8m";
      metric.numericValue = 1800000;
    });
    expect(() => validateEvidenceExtractionOutput(mOutput, "Revenue was £1.8m."))
      .not.toThrow();
  });

  it("does not normalize ambiguous unqualified m shorthand", () => {
    const output = outputWith((value) => {
      const item = (value.evidence as Array<Record<string, unknown>>)[0];
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      item.sourceExcerpt = "1.8m";
      item.valueNumeric = 1800000;
      metric.sourceExcerpt = "1.8m";
      metric.numericValue = 1800000;
    });
    expect(() => validateEvidenceExtractionOutput(output, "The stated value was 1.8m."))
      .toThrow("not explicitly present");
  });

  it("matches percentage values as explicitly written", () => {
    const output = outputWith((value) => {
      const item = (value.evidence as Array<Record<string, unknown>>)[0];
      const metric = (value.metrics as Array<Record<string, unknown>>)[0];
      item.sourceExcerpt = "12.5%";
      item.valueNumeric = 12.5;
      metric.sourceExcerpt = "12.5%";
      metric.numericValue = 12.5;
    });
    expect(() => validateEvidenceExtractionOutput(output, "Conversion was 12.5%."))
      .not.toThrow();
  });

  it("rejects a mismatched Metric numeric value", () => {
    const output = outputWith((value) => {
      (value.metrics as Array<Record<string, unknown>>)[0].numericValue = 81000;
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .toThrow("metric_1 numeric value 81000 is not explicitly present");
  });

  it("rejects a mismatched Evidence numeric value", () => {
    const output = outputWith((value) => {
      (value.evidence as Array<Record<string, unknown>>)[0].valueNumeric = 81000;
    });
    expect(() => validateEvidenceExtractionOutput(output, baslonMessyIntake))
      .toThrow("evidence_1 numeric value 81000 is not explicitly present");
  });

  it("takes Business ownership only from application input", () => {
    expect(evidenceExtractionInputSchema.parse({
      businessId: "7daebfd8-e321-4a45-8e2c-532c05667f8f",
      rawIntakeText: baslonMessyIntake,
    })).toMatchObject({
      businessId: "7daebfd8-e321-4a45-8e2c-532c05667f8f",
    });
    expect(() => evidenceExtractionOutputSchema.parse({
      ...baslonExtractionOutput,
      businessId: "7daebfd8-e321-4a45-8e2c-532c05667f8f",
    })).toThrow();
  });
});
