import { describe, expect, it } from "vitest";
import {
  evidenceExtractionInputSchema,
  evidenceExtractionOutputSchema,
} from "@/ai/evidence-extractor/contracts";
import { validateEvidenceExtractionOutput } from "@/ai/evidence-extractor/validation";
import { evidenceExtractorPrompt } from "@/ai/evidence-extractor/prompt";
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

  it("accepts separate Evidence proposals for measurements with different units", () => {
    const source = "Recurring revenue is around £1,200 per month and around 10% of revenue comes from ad-hoc support work.";
    const output = structuredClone(baslonExtractionOutput);
    output.claims = [];
    output.metrics = [];
    output.relationships = [];
    output.evidence = [
      {
        ...output.evidence[0], proposalRef: "evidence_currency",
        statement: "Recurring revenue is approximately £1,200 per month.",
        valueNumeric: 1200, valueText: "£1,200 per month", unit: "GBP per month",
        sourceExcerpt: "Recurring revenue is around £1,200 per month",
      },
      {
        ...output.evidence[0], proposalRef: "evidence_percent",
        statement: "Approximately 10% of revenue comes from ad-hoc support.",
        valueNumeric: 10, valueText: "10%", unit: "percent",
        sourceExcerpt: "around 10% of revenue comes from ad-hoc support work",
      },
    ];
    expect(validateEvidenceExtractionOutput(output, source).evidence).toHaveLength(2);
  });

  it("rejects one Evidence proposal containing incompatible measurements", () => {
    const source = "Recurring revenue is around £1,200 per month and around 10% of revenue comes from ad-hoc support work.";
    const output = structuredClone(baslonExtractionOutput);
    output.evidence[0] = {
      ...output.evidence[0],
      statement: source,
      valueNumeric: 1200,
      valueText: "£1,200 per month and 10%",
      unit: "GBP per month; percent",
      sourceExcerpt: source,
    };
    expect(() => validateEvidenceExtractionOutput(output, `${baslonMessyIntake}\n${source}`))
      .toThrow("combines independent numeric measurements with incompatible units");
  });

  it("instructs the model to omit unrelated or uncertain relationships", () => {
    expect(evidenceExtractorPrompt).toContain("If the relationship is uncertain, omit it");
    expect(evidenceExtractorPrompt).toContain("Annual revenue does not by itself support an acquisition-channel hypothesis");
    expect(evidenceExtractorPrompt).toContain("acquisition-source evidence does not support a working-hours goal");
    expect(evidenceExtractorPrompt).toContain("missing CAC/LTV data does not support an unrelated client-result Claim");
    expect(evidenceExtractorPrompt).toContain("client enquiry count does not support an unrelated Baslon acquisition-source Claim");
  });

  it("allows weak or unrelated Claim/Evidence pairs to be omitted", () => {
    const output = structuredClone(baslonExtractionOutput);
    output.relationships = [];
    expect(validateEvidenceExtractionOutput(output, baslonMessyIntake).relationships).toEqual([]);
  });

  it("represents independently stated data gaps as separate Evidence proposals", () => {
    const source = "we do not have reliable figures for conversion rate, CAC, LTV or channel mix";
    const output = structuredClone(baslonExtractionOutput);
    output.claims = [];
    output.metrics = [];
    output.relationships = [];
    output.evidence = ["conversion rate", "CAC", "LTV", "channel mix"].map((gap, index) => ({
      ...output.evidence[0],
      proposalRef: `evidence_gap_${index + 1}`,
      statement: `Reliable figures for ${gap} are unavailable.`,
      valueNumeric: null,
      valueText: null,
      unit: null,
      materiality: "medium",
      sourceExcerpt: source,
    }));

    expect(validateEvidenceExtractionOutput(output, source).evidence.map((item) => item.statement))
      .toEqual([
        "Reliable figures for conversion rate are unavailable.",
        "Reliable figures for CAC are unavailable.",
        "Reliable figures for LTV are unavailable.",
        "Reliable figures for channel mix are unavailable.",
      ]);
    expect(evidenceExtractorPrompt).toContain("requires four Evidence proposals");
  });

  it("reserves supports for Evidence that substantiates an evaluation", () => {
    expect(evidenceExtractorPrompt).toContain("not merely its topic or descriptive background");
    expect(evidenceExtractorPrompt).toContain("does not support the evaluation that referrals and marketplace are doing too much of the heavy lifting");
    expect(evidenceExtractorPrompt).toContain("does not by itself establish that the breadth makes the business harder to market");
    expect(evidenceExtractorPrompt).toContain("Prefer context or omit the relationship");
  });

  it("does not convert the number word in three-day into numeric 3", () => {
    const source = "The founder would ideally like roughly a three-day working week.";
    const output = structuredClone(baslonExtractionOutput);
    output.evidence[0] = {
      ...output.evidence[0],
      statement: "The founder prefers roughly a three-day working week.",
      valueNumeric: 3,
      valueText: "roughly a three-day working week",
      unit: "days per week",
      materiality: "medium",
      sourceExcerpt: "roughly a three-day working week",
    };
    expect(() => validateEvidenceExtractionOutput(output, `${baslonMessyIntake}\n${source}`))
      .toThrow("numeric value 3 is not explicitly present");
  });

  it("accepts numeric 30 when the exact excerpt says 30-hour", () => {
    const source = "The founder would ideally like a 30-hour working week.";
    const output = structuredClone(baslonExtractionOutput);
    output.evidence[0] = {
      ...output.evidence[0],
      statement: "The founder prefers a 30-hour working week.",
      valueNumeric: 30,
      valueText: "30-hour working week",
      unit: "hours per week",
      materiality: "medium",
      sourceExcerpt: "30-hour working week",
    };
    expect(() => validateEvidenceExtractionOutput(output, `${baslonMessyIntake}\n${source}`))
      .not.toThrow();
  });

  it("preserves three-day as qualitative Evidence without numeric fields", () => {
    const source = "The founder would like roughly a three-day working week.";
    const output = structuredClone(baslonExtractionOutput);
    output.evidence[0] = {
      ...output.evidence[0],
      statement: "The founder would like roughly a three-day working week.",
      valueNumeric: null,
      valueText: "roughly a three-day working week",
      unit: null,
      materiality: "low",
      sourceExcerpt: "roughly a three-day working week",
    };
    const result = validateEvidenceExtractionOutput(output, `${baslonMessyIntake}\n${source}`);
    expect(result.evidence[0]).toMatchObject({
      valueNumeric: null,
      unit: null,
      materiality: "low",
    });
  });

  it("instructs preference evidence to default below high materiality", () => {
    expect(evidenceExtractorPrompt).toContain("must not automatically receive high strategic materiality");
    expect(evidenceExtractorPrompt).toContain("default such preferences to low or medium materiality");
    expect(evidenceExtractorPrompt).toContain("30-hour working week should therefore default to low or medium materiality");
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
