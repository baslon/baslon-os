import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  evidenceExtractionOutputSchema,
  readStoredEvidenceProposal,
  readStoredMetricProposal,
  reviewableEvidenceProposalSchema,
  reviewableMetricProposalSchema,
} from "@/ai/evidence-extractor/contracts";
import { evidenceExtractorContextPrompt, evidenceExtractorPrompt } from "@/ai/evidence-extractor/prompt";
import { numericPrecisionIssue, validateEvidenceExtractionOutput } from "@/ai/evidence-extractor/validation";
import { EVIDENCE_COHERENCE_PROMPT_VERSION, evidenceCoherencePrompt } from "@/ai/evidence-coherence/prompt";
import { buildEvidenceCoherenceProjection } from "@/domain/evidence-coherence-projection";
import { evidenceCorrectionSchema, metricCorrectionSchema } from "@/domain/evidence-review";
import { numericShapeIssue, readNumericPrecision } from "@/domain/numeric-precision";
import { formatWorkspaceMetric } from "@/domain/workspace-metrics";
import { ProposalNumericValue } from "../../app/proposal-numeric-value";
import { EvidenceValue } from "../../app/evidence-value";
import { ProposalCorrectionFields } from "../../app/proposal-review-controls";
import {
  baslonExtractionOutput,
  legacyEvidenceProposal,
  legacyMetricProposal,
} from "../fixtures/baslon-business";

type Precision = "exact" | "approximate" | "estimate" | "range";

/** One Evidence proposal with a matching Metric, both citing the same excerpt. */
function numericOutput(input: {
  excerpt: string;
  precision: Precision;
  value?: number | null;
  lower?: number | null;
  upper?: number | null;
  unit?: string;
}) {
  const output = structuredClone(baslonExtractionOutput);
  const value = input.value ?? null;
  const lower = input.lower ?? null;
  const upper = input.upper ?? null;
  const unit = input.unit ?? "projects";
  output.claims = [];
  output.relationships = [];
  output.evidence = [{
    ...output.evidence[0],
    statement: input.excerpt, valueText: input.excerpt, unit,
    valueNumeric: value, valuePrecision: input.precision, valueLower: lower, valueUpper: upper,
    sourceExcerpt: input.excerpt, rawPayload: { excerpt: input.excerpt },
  }];
  output.metrics = [{
    ...output.metrics[0],
    metricKey: "projects", metricLabel: "Projects", unit,
    numericValue: value, numericPrecision: input.precision, numericLower: lower, numericUpper: upper,
    sourceExcerpt: input.excerpt,
  }];
  return output;
}

const validate = (output: unknown, source: string) => validateEvidenceExtractionOutput(output, source);

describe("M4-02A numeric precision: domain and contracts", () => {
  it.each(["exact", "approximate", "estimate"] as const)("accepts %s with a single value", (precision) => {
    const output = numericOutput({ excerpt: "12 projects", precision, value: 12 });
    expect(() => evidenceExtractionOutputSchema.parse(output)).not.toThrow();
    expect(numericShapeIssue({ precision, value: 12, lower: null, upper: null })).toBeUndefined();
  });

  it("accepts a valid range with both bounds and no single value", () => {
    const output = numericOutput({ excerpt: "10–15 projects", precision: "range", lower: 10, upper: 15 });
    expect(() => evidenceExtractionOutputSchema.parse(output)).not.toThrow();
    expect(numericShapeIssue({ precision: "range", value: null, lower: 10, upper: 15 })).toBeUndefined();
  });

  it("allows unspecified only for review/legacy shapes, never for a new extractor proposal", () => {
    const output = numericOutput({ excerpt: "12 projects", precision: "exact", value: 12 });
    output.evidence[0].valuePrecision = "unspecified" as never;
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
    expect(() => reviewableEvidenceProposalSchema.parse({ ...output.evidence[0] })).not.toThrow();
    expect(() => reviewableMetricProposalSchema.parse({ ...output.metrics[0], numericPrecision: "unspecified" }))
      .not.toThrow();
    expect(evidenceCorrectionSchema.parse({ valuePrecision: "unspecified" }).valuePrecision).toBe("unspecified");
  });

  it("rejects invalid precision vocabulary everywhere", () => {
    const output = numericOutput({ excerpt: "12 projects", precision: "exact", value: 12 });
    output.metrics[0].numericPrecision = "precise" as never;
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
    expect(() => evidenceCorrectionSchema.parse({ valuePrecision: "roughly" })).toThrow();
    expect(() => metricCorrectionSchema.parse({ numericPrecision: "guess" })).toThrow();
    expect(readNumericPrecision("guess")).toBe("unspecified");
    expect(readNumericPrecision(undefined)).toBe("unspecified");
  });

  it("rejects a range whose lower bound exceeds its upper bound", () => {
    const output = numericOutput({ excerpt: "15–10 projects", precision: "range", lower: 15, upper: 10 });
    expect(() => evidenceExtractionOutputSchema.parse(output)).toThrow();
    expect(numericShapeIssue({ precision: "range", value: null, lower: 15, upper: 10 }))
      .toBe("a range lower bound cannot exceed its upper bound");
  });

  it("rejects malformed numeric shapes", () => {
    expect(numericShapeIssue({ precision: "range", value: 12, lower: 10, upper: 15 })).toBeDefined();
    expect(numericShapeIssue({ precision: "range", value: null, lower: 10, upper: null })).toBeDefined();
    expect(numericShapeIssue({ precision: "exact", value: 12, lower: 10, upper: 15 })).toBeDefined();
    expect(numericShapeIssue({ precision: "exact", value: null, lower: null, upper: null })).toBeDefined();
    expect(numericShapeIssue({ precision: null, value: 12, lower: null, upper: null })).toBeDefined();
    const collapsed = numericOutput({ excerpt: "10–15 projects", precision: "range", value: 12.5, lower: 10, upper: 15 });
    expect(() => evidenceExtractionOutputSchema.parse(collapsed)).toThrow();
  });
});

describe("M4-02A numeric precision: extraction grounding", () => {
  it("accepts an exact source as an exact proposal", () => {
    const source = "We delivered 12 projects last year.";
    const result = validate(numericOutput({ excerpt: "12 projects", precision: "exact", value: 12 }), source);
    expect(result.evidence[0]).toMatchObject({ valueNumeric: 12, valuePrecision: "exact" });
  });

  it("does not let \"about 30\" become an unqualified exact 30", () => {
    const source = "We have about 30 clients.";
    expect(() => validate(numericOutput({ excerpt: "about 30 clients", precision: "exact", value: 30, unit: "clients" }), source))
      .toThrow("not exact");
    expect(validate(numericOutput({ excerpt: "about 30 clients", precision: "approximate", value: 30, unit: "clients" }), source)
      .metrics[0]).toMatchObject({ numericValue: 30, numericPrecision: "approximate" });
  });

  it("preserves approximation for \"roughly £4k\"", () => {
    const source = "Monthly retainers bring in roughly £4k.";
    const result = validate(numericOutput({ excerpt: "roughly £4k", precision: "approximate", value: 4000, unit: "GBP" }), source);
    expect(result.evidence[0]).toMatchObject({ valueNumeric: 4000, valuePrecision: "approximate" });
    expect(() => validate(numericOutput({ excerpt: "roughly £4k", precision: "exact", value: 4000, unit: "GBP" }), source))
      .toThrow("not exact");
  });

  it("preserves both bounds for \"10–15 projects\" and refuses to collapse them", () => {
    const source = "We run 10–15 projects a year.";
    const result = validate(numericOutput({ excerpt: "10–15 projects", precision: "range", lower: 10, upper: 15 }), source);
    expect(result.evidence[0]).toMatchObject({ valueNumeric: null, valueLower: 10, valueUpper: 15, valuePrecision: "range" });
    expect(result.metrics[0]).toMatchObject({ numericValue: null, numericLower: 10, numericUpper: 15 });
    for (const value of [10, 15]) {
      expect(() => validate(numericOutput({ excerpt: "10–15 projects", precision: "exact", value }), source))
        .toThrow("not exact");
    }
    expect(() => validate(numericOutput({ excerpt: "10–15 projects", precision: "exact", value: 12.5 }), source))
      .toThrow("not explicitly present");
    expect(() => validate(numericOutput({ excerpt: "10–15 projects", precision: "range", lower: 10, upper: 20 }), source))
      .toThrow("not stated as one range expression");
  });

  it("grounds ranges written with to, hyphens and between…and", () => {
    for (const excerpt of ["10 to 15 projects", "10-15 projects", "between 10 and 15 projects"]) {
      expect(numericPrecisionIssue({ precision: "range", value: null, lower: 10, upper: 15, sourceExcerpt: excerpt }))
        .toBeUndefined();
    }
    expect(numericPrecisionIssue({ precision: "range", value: null, lower: 10, upper: 15, sourceExcerpt: "10 projects and 15 staff" }))
      .toBeDefined();
  });

  it("requires estimate language for estimates and rejects limits as values", () => {
    expect(numericPrecisionIssue({ precision: "estimate", value: 20, lower: null, upper: null, sourceExcerpt: "I'd estimate 20 leads a month" }))
      .toBeUndefined();
    expect(numericPrecisionIssue({ precision: "estimate", value: 20, lower: null, upper: null, sourceExcerpt: "20 leads a month" }))
      .toContain("no estimate language");
    expect(numericPrecisionIssue({ precision: "exact", value: 20, lower: null, upper: null, sourceExcerpt: "I'd estimate 20 leads a month" }))
      .toContain("presented as an estimate");
    for (const precision of ["exact", "approximate", "estimate"] as const) {
      expect(numericPrecisionIssue({ precision, value: 30, lower: null, upper: null, sourceExcerpt: "we probably have more than 30 clients" }))
        .toBeDefined();
    }
  });

  it("applies the aligned M4-10 written-number rule", () => {
    expect(() => validate(numericOutput({ excerpt: "twelve projects", precision: "exact", value: 12 }), "We ran twelve projects."))
      .not.toThrow();
    expect(() => validate(numericOutput({ excerpt: "twenty-five projects", precision: "exact", value: 25 }), "We ran twenty-five projects."))
      .not.toThrow();
    // Approximate number words stay qualitative rather than becoming numbers.
    for (const precision of ["exact", "approximate"] as const) {
      expect(() => validate(numericOutput({ excerpt: "about ten projects", precision, value: 10 }), "We ran about ten projects."))
        .toThrow("not explicitly present");
    }
    // Compound descriptions and words outside zero–ninety-nine are not numbers.
    expect(() => validate(numericOutput({ excerpt: "a three-day week", precision: "exact", value: 3, unit: "days" }), "I want a three-day week."))
      .toThrow("not explicitly present");
    expect(() => validate(numericOutput({ excerpt: "a hundred projects", precision: "exact", value: 100 }), "We ran a hundred projects."))
      .toThrow("not explicitly present");
    expect(evidenceExtractorPrompt).toContain("about ten");
  });

  it("rejects numbers that appear only in the question context", () => {
    const answer = "Mostly referrals";
    const output = numericOutput({ excerpt: "about 30 clients", precision: "approximate", value: 30, unit: "clients" });
    expect(() => validate(output, answer)).toThrow("source excerpt is not present");
    expect(evidenceExtractorContextPrompt).toContain("question as INTERPRETIVE CONTEXT only");
  });

  it("requires a Metric to carry the same precision as its numeric source Evidence", () => {
    const source = "We have about 30 clients.";
    const output = numericOutput({ excerpt: "about 30 clients", precision: "approximate", value: 30, unit: "clients" });
    output.metrics[0].numericPrecision = "exact";
    expect(() => validate(output, source)).toThrow("does not match its source Evidence");
  });
});

describe("M4-02A numeric precision: legacy and presentation", () => {
  const legacyEvidence = legacyEvidenceProposal;
  const legacyMetric = legacyMetricProposal;

  it("reads pre-precision stored proposals as unspecified without inferring from wording", () => {
    // The legacy excerpt says "about £80k", but nothing is inferred from it.
    expect(readStoredEvidenceProposal(legacyEvidence)).toMatchObject({
      valueNumeric: 80000, valuePrecision: "unspecified", valueLower: null, valueUpper: null,
    });
    expect(readStoredEvidenceProposal({ ...legacyEvidence, valueNumeric: null, unit: null }).valuePrecision).toBeNull();
    expect(readStoredMetricProposal(legacyMetric)).toMatchObject({
      numericValue: 80000, numericPrecision: "unspecified", numericLower: null, numericUpper: null,
    });
  });

  it("shows the reviewer the value and precision before acceptance, including for legacy proposals", () => {
    const range = numericOutput({ excerpt: "10–15 projects", precision: "range", lower: 10, upper: 15 });
    const rangeHtml = renderToStaticMarkup(createElement(ProposalNumericValue, { proposalType: "metric", payload: range.metrics[0] }));
    expect(rangeHtml).toContain("10–15 projects");
    expect(rangeHtml).toContain("Precision: Range");
    const legacyHtml = renderToStaticMarkup(createElement(ProposalNumericValue, { proposalType: "evidence", payload: legacyEvidence }));
    expect(legacyHtml).toContain("£80,000");
    expect(legacyHtml).toContain("Precision: Unspecified");
  });

  it("lets the reviewer correct precision and range bounds", () => {
    const html = renderToStaticMarkup(createElement(ProposalCorrectionFields, {
      proposal: { id: "p", proposalRef: "metric_1", proposalType: "metric", structuredPayload: baslonExtractionOutput.metrics[0] } as never,
    }));
    expect(html).toContain('name="numericPrecision"');
    expect(html).toContain('name="numericLower"');
    expect(html).toContain('name="numericUpper"');
    for (const option of ["Exact", "Approximate", "Estimate", "Range", "Unspecified"]) expect(html).toContain(`>${option}</option>`);
  });

  it("never renders approximate, estimated or range values as bare exact numbers", () => {
    expect(formatWorkspaceMetric({ numericValue: "80000", unit: "GBP", numericPrecision: "approximate" })).toBe("about £80,000");
    expect(formatWorkspaceMetric({ numericValue: "20", unit: "leads", numericPrecision: "estimate" })).toBe("20 leads (estimate)");
    expect(formatWorkspaceMetric({ numericValue: null, unit: "GBP", numericPrecision: "range", numericLower: "10000", numericUpper: "15000" }))
      .toBe("£10,000–£15,000");
    expect(formatWorkspaceMetric({ numericValue: null, unit: "percent", numericPrecision: "range", numericLower: "10", numericUpper: "15" }))
      .toBe("10–15%");
    const html = renderToStaticMarkup(createElement(EvidenceValue, {
      statement: "Revenue", valueNumeric: "80000.0000", valueText: null, unit: "GBP",
    }));
    expect(html).toContain("Precision: Unspecified");
  });

  it("projects precision from new snapshots and legacy snapshot rows as unspecified", () => {
    const base = { id: "00000000-0000-4000-8000-000000000002", businessId: "00000000-0000-4000-8000-000000000001", version: 1 };
    const legacy = buildEvidenceCoherenceProjection({ ...base, snapshotData: {
      evidence: [{ id: "e1", statement: "Revenue", valueNumeric: "80000.0000" }],
      metrics: [{ id: "m1", metricKey: "revenue", metricLabel: "Revenue", numericValue: "80000.0000", unit: "GBP" }],
    } });
    expect(legacy.evidence[0]).toMatchObject({ valuePrecision: "unspecified", valueLower: null, valueUpper: null });
    expect(legacy.metrics[0]).toMatchObject({ numericValue: "80000.0000", numericPrecision: "unspecified" });
    const current = buildEvidenceCoherenceProjection({ ...base, snapshotData: {
      evidence: [{ id: "e1", statement: "Projects", valueNumeric: null, valuePrecision: "range", valueLower: "10.0000", valueUpper: "15.0000" }],
      metrics: [{ id: "m1", metricKey: "projects", metricLabel: "Projects", numericValue: null, numericPrecision: "range", numericLower: "10.0000", numericUpper: "15.0000", unit: "projects" }],
    } });
    expect(current.evidence[0]).toMatchObject({ valueNumeric: null, valuePrecision: "range", valueLower: "10.0000", valueUpper: "15.0000" });
    expect(current.metrics[0]).toMatchObject({ numericValue: null, numericPrecision: "range", numericLower: "10.0000" });
    expect(EVIDENCE_COHERENCE_PROMPT_VERSION).toBe("evidence_coherence_v3");
    expect(evidenceCoherencePrompt).toContain("unspecified");
  });
});
