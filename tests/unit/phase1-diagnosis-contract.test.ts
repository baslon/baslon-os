import { describe, expect, it } from "vitest";
import {
  phase1DiagnosisJsonSchema,
  phase1DiagnosisOutputSchema,
} from "@/ai/phase1-diagnosis/contracts";
import {
  PHASE1_DIAGNOSIS_PROMPT_VERSION,
  phase1DiagnosisPrompt,
} from "@/ai/phase1-diagnosis/prompt";
import { buildEvidenceCoherenceModelInput } from "@/domain/evidence-coherence-projection";
import {
  PHASE1_DIAGNOSIS_ARTIFACT_VERSION,
  PHASE1_DIAGNOSIS_INPUT_VERSION,
  type CarriedForwardGap,
  type DiagnosisItemDraft,
} from "@/domain/phase1-diagnosis";
import { resolveDiagnosisHandle } from "@/domain/phase1-diagnosis-handles";
import {
  buildPhase1DiagnosisInput,
  hashPhase1DiagnosisInput,
  withCalculationReferences,
} from "@/domain/phase1-diagnosis-projection";
import {
  Phase1DiagnosisContractError,
  validateDiagnosisItem,
  validatePhase1DiagnosisOutput,
} from "@/domain/phase1-diagnosis-validation";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const businessId = "d1000000-0000-4000-8000-000000000001";
const otherBusinessId = "d1000000-0000-4000-8000-000000000002";
const coherenceRunId = "d1000000-0000-4000-8000-0000000000c1";
// The rebuild's twice-corrupted Evidence UUID, reused here in a synthetic fixture.
const profitGapId = "4142656f-8877-447b-86c9-5c0c3e35a58d";
const ids = {
  claim: "c2000000-0000-4000-8000-000000000001",
  revenue: "e2000000-0000-4000-8000-000000000001",
  range: "e2000000-0000-4000-8000-000000000002",
  unspecified: "e2000000-0000-4000-8000-000000000003",
  monthly: "a2000000-0000-4000-8000-000000000001",
  monthlyRange: "a2000000-0000-4000-8000-000000000002",
  monthlyUnspecified: "a2000000-0000-4000-8000-000000000003",
  annual: "a2000000-0000-4000-8000-000000000004",
};

const at = (minute: number) => `2026-09-01T09:${String(minute).padStart(2, "0")}:00.000Z`;
const evidenceRow = (id: string, statement: string, minute: number, extra: Record<string, unknown> = {}) => ({
  id, businessId, statement, createdAt: at(minute), valueNumeric: null, valuePrecision: null, valueLower: null, valueUpper: null,
  valueText: null, unit: null, periodStart: null, periodEnd: null, sourceType: "test", sourceReference: null,
  reliabilityLevel: "medium", directnessLevel: "direct", recencyLevel: "current", materiality: "high", ...extra,
});
const metricRow = (id: string, label: string, minute: number, extra: Record<string, unknown>) => ({
  id, businessId, metricKey: label.toLowerCase().replaceAll(" ", "_"), metricLabel: label, createdAt: at(minute),
  numericValue: null, numericPrecision: "approximate", numericLower: null, numericUpper: null, unit: "GBP per month",
  periodStart: null, periodEnd: null, sourceEvidenceId: null, ...extra,
});

function records() {
  return {
    claims: [{ id: ids.claim, businessId, statement: "Referrals matter most.", claimType: "management_belief", subjectArea: "acquisition", status: "active", supersededByClaimId: null, createdAt: at(1) }],
    evidence: [
      evidenceRow(ids.revenue, "Revenue was approximately £240,000.", 2, { valueNumeric: "240000.0000", valuePrecision: "approximate", unit: "GBP" }),
      evidenceRow(profitGapId, "Reliable profit figures are unavailable.", 3),
      evidenceRow(ids.range, "Projects numbered 10 to 15.", 4, { valuePrecision: "range", valueLower: "10.0000", valueUpper: "15.0000", unit: "projects" }),
      evidenceRow(ids.unspecified, "Revenue was 80000.", 5, { valueNumeric: "80000.0000" }),
    ],
    metrics: [
      metricRow(ids.monthly, "Recurring monthly revenue", 6, { numericValue: "1200.0000", sourceEvidenceId: ids.revenue }),
      metricRow(ids.monthlyRange, "Retainer range", 7, { numericPrecision: "range", numericLower: "500.0000", numericUpper: "900.0000" }),
      metricRow(ids.monthlyUnspecified, "Legacy monthly figure", 8, { numericPrecision: "unspecified", numericValue: "300.0000" }),
      metricRow(ids.annual, "Annual revenue", 9, { numericValue: "240000.0000", unit: "GBP" }),
    ],
    claimEvidence: [{ businessId, claimId: ids.claim, evidenceId: ids.revenue, relationshipType: "context", strengthScore: "0.3" }],
  };
}

const gaps: CarriedForwardGap[] = [
  "Costs and profit are untracked.",
  "Opportunity history is untracked.",
  "Channel data is untracked.",
  "Revenue-mix baseline is undefined.",
  "Segment metrics are untracked.",
  "Founder time allocation is untracked.",
].map((missingInformation, index) => ({
  id: `f3000000-0000-4000-8000-00000000000${6 - index}`,
  analysisRunId: coherenceRunId,
  area: "financial_performance",
  missingInformation,
  decisionImpact: "Limits the diagnosis.",
  materiality: index < 4 ? "high" : "medium",
  priorityRank: index + 1,
}));

function snapshot(data = records(), version = 4) {
  return { id: "5d000000-0000-4000-8000-000000000004", businessId, version, snapshotData: { profile: {}, ...data } };
}

function built(data = records(), version = 4) {
  const input = buildPhase1DiagnosisInput({ snapshot: snapshot(data, version), gaps });
  const references = withCalculationReferences(input.references, input.calculations.map((item, index) => ({
    ...item, id: `ca000000-0000-4000-8000-00000000000${index + 1}`,
  })));
  return { ...input, references };
}

function item(overrides: Partial<DiagnosisItemDraft> = {}): DiagnosisItemDraft {
  return {
    itemType: "position",
    statement: "Revenue was approximately £240,000.",
    rationale: "Stated in the revenue evidence.",
    grounding: "evidence_backed",
    materiality: "high",
    interpretationConfidence: "high",
    limitations: null,
    references: [{ entityType: "evidence", ref: "E001", role: "primary" }],
    ...overrides,
  };
}

const issuesOf = (draft: DiagnosisItemDraft, input = built()) => validateDiagnosisItem(draft, input.references).issues;

describe("Phase 1 Diagnosis input (M4-05)", () => {
  it("binds to the exact snapshot content and hashes deterministically, independent of stored order", () => {
    const first = built();
    const shuffled = records();
    shuffled.evidence.reverse();
    shuffled.metrics.reverse();
    const again = built(shuffled);
    expect(first.modelInput.inputVersion).toBe(PHASE1_DIAGNOSIS_INPUT_VERSION);
    expect(hashPhase1DiagnosisInput(again.modelInput)).toBe(hashPhase1DiagnosisInput(first.modelInput));
    expect([...again.references]).toEqual([...first.references]);
    const changed = records();
    changed.evidence[0].statement = "Revenue was approximately £250,000.";
    expect(hashPhase1DiagnosisInput(built(changed).modelInput)).not.toBe(hashPhase1DiagnosisInput(first.modelInput));
    expect(built(changed).snapshotContentHash).not.toBe(first.snapshotContentHash);
    expect(first.snapshotContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses the Evidence Coherence v3 C/E/M handles and adds G (gaps) and D (calculations)", () => {
    const input = built();
    const coherence = buildEvidenceCoherenceModelInput(snapshot());
    expect(input.modelInput.snapshot).toEqual(coherence.modelInput.snapshot);
    expect(input.references.get("E002")?.id).toBe(profitGapId);
    expect(input.modelInput.validatedGaps.map((gap) => gap.handle)).toEqual(["G001", "G002", "G003", "G004", "G005", "G006"]);
    expect(input.modelInput.calculations.map((calculation) => calculation.handle)).toEqual(["D001", "D002", "D003"]);
  });

  it("carries all six validated gaps and sends no canonical UUID to the model", () => {
    const input = built();
    expect(input.modelInput.validatedGaps).toHaveLength(6);
    expect(input.modelInput.validatedGaps.map((gap) => gap.missingInformation)).toEqual(gaps.map((gap) => gap.missingInformation));
    expect(JSON.stringify(input.modelInput)).not.toMatch(uuid);
    expect(() => buildPhase1DiagnosisInput({ snapshot: snapshot(), gaps: [...gaps, { ...gaps[0], id: "f3000000-0000-4000-8000-000000000009", analysisRunId: "d1000000-0000-4000-8000-0000000000c2" }] }))
      .toThrow("one Evidence Coherence run");
  });
});

describe("Deterministic calculations (M4-06)", () => {
  it("are labelled derived, preserve precision, keep ranges as ranges and never upgrade unspecified", () => {
    const [approximate, range, unspecified] = built().modelInput.calculations;
    expect(approximate).toMatchObject({ derived: true, valueNumeric: "14400.0000", valuePrecision: "approximate", unit: "GBP per year", sourceHandles: ["M001"] });
    expect(approximate.formula).toContain("not realised revenue");
    expect(range).toMatchObject({ valueNumeric: null, valuePrecision: "range", valueLower: "6000.0000", valueUpper: "10800.0000" });
    expect(unspecified).toMatchObject({ valueNumeric: "3600.0000", valuePrecision: "unspecified" });
    // Only monthly currency Metrics qualify; an annual figure yields nothing.
    expect(built().calculations.flatMap((item) => item.sources.map((source) => source.id))).not.toContain(ids.annual);
  });

  it("do not depend on qualifiers or strengthScore", () => {
    const changed = records();
    changed.evidence[0].reliabilityLevel = "low";
    changed.claimEvidence[0].strengthScore = "0.99";
    expect(built(changed).calculations).toEqual(built().calculations);
    expect(built(changed).modelInput.snapshot.relationships[0].strengthScore).toBe("0.99");
  });
});

describe("Run-local handle resolution", () => {
  it("resolves valid handles and rejects unknown, malformed and wrong-type handles", () => {
    const { references } = built();
    expect(resolveDiagnosisHandle(references, "gap", "G006")).toMatchObject({ ok: true, reference: { entityType: "gap" } });
    expect(resolveDiagnosisHandle(references, "evidence", "E099")).toEqual({ ok: false, issue: "unknown" });
    expect(resolveDiagnosisHandle(references, "evidence", profitGapId)).toEqual({ ok: false, issue: "malformed" });
    expect(resolveDiagnosisHandle(references, "claim", "E001")).toEqual({ ok: false, issue: "wrong_type" });
    expect(issuesOf(item({ references: [{ entityType: "evidence", ref: "E099", role: "primary" }] })).join()).toContain("is not in this diagnosis input");
    expect(issuesOf(item({ references: [{ entityType: "claim", ref: "E001", role: "primary" }] })).join()).toContain("namespace");
  });

  it("cannot resolve records from another snapshot or another Business", () => {
    const earlier = records();
    earlier.evidence = earlier.evidence.slice(0, 1);
    const snapshotOne = built(earlier, 1);
    expect(issuesOf(item({ references: [{ entityType: "evidence", ref: "E002", role: "primary" }] }), snapshotOne).join()).toContain("is not in this diagnosis input");
    const foreign = records();
    foreign.evidence[1] = { ...foreign.evidence[1], businessId: otherBusinessId };
    expect(() => built(foreign)).toThrow("from another Business");
  });

  it("rejects model output that reproduces a canonical UUID, and rejects the whole output for one bad item", () => {
    const { references } = built();
    const output = { items: [item(), item({ references: [{ entityType: "evidence", ref: profitGapId, role: "primary" }] })] };
    expect(() => validatePhase1DiagnosisOutput(output, references)).toThrow();
    expect(() => validatePhase1DiagnosisOutput({ items: [item(), item({ references: [] })] }, references))
      .toThrow(Phase1DiagnosisContractError);
    expect(validatePhase1DiagnosisOutput({ items: [item()] }, references)[0].references[0]).toMatchObject({ id: ids.revenue, ref: "E001" });
  });
});

describe("Grounding and missing-data guardrails (M4-05)", () => {
  const gapLimited = { grounding: "interpretive" as const, limitations: "The data is untracked.", references: [{ entityType: "gap" as const, ref: "G003", role: "limiting_gap" as const }] };

  it("accepts statements of what cannot be established", () => {
    expect(issuesOf(item({ ...gapLimited, statement: "Channel efficiency cannot currently be quantified because channel-level conversion and cost data are unavailable." }))).toEqual([]);
    expect(issuesOf(item({ ...gapLimited, statement: "Profitability cannot be established from the available evidence." }))).toEqual([]);
  });

  it("rejects negative verdicts drawn from missing data", () => {
    expect(issuesOf(item({ ...gapLimited, statement: "LinkedIn is ineffective." })).join()).toContain("missing data is not evidence of poor performance");
    expect(issuesOf(item({ ...gapLimited, statement: "The business is unprofitable." })).join()).toContain("missing data is not evidence of poor performance");
    // Citing a data-gap Evidence record as "support" is not quantitative support.
    expect(issuesOf(item({ statement: "The business is unprofitable.", references: [{ entityType: "evidence", ref: "E002", role: "primary" }] })).join())
      .toContain("without quantitative primary support");
  });

  it("requires primary support for evidence-backed and calculated items, and limitations for interpretation", () => {
    expect(issuesOf(item({ references: [{ entityType: "evidence", ref: "E001", role: "context" }] })).join()).toContain("cites no primary");
    expect(issuesOf(item({ grounding: "calculated" })).join()).toContain("cites no primary calculation");
    expect(issuesOf(item({ grounding: "calculated", references: [{ entityType: "calculation", ref: "D001", role: "primary" }] }))).toEqual([]);
    expect(issuesOf(item({ grounding: "hypothesis", limitations: null })).join()).toContain("must state its limitations");
    expect(issuesOf(item({ references: [{ entityType: "gap", ref: "G001", role: "primary" }] })).join()).toContain("limiting_gap");
  });
});

describe("Qualifier and precision semantics (M4-06)", () => {
  it("rejects qualifiers or strengthScore used as truth weights or probabilities", () => {
    expect(issuesOf(item({ rationale: "The strengthScore of 0.9 makes this claim likely true." })).join()).toContain("truth weight");
    expect(issuesOf(item({ rationale: "The probability that referrals are the main channel is high and it is true." })).join()).toContain("truth weight");
    expect(issuesOf(item({ rationale: "Averaging reliability and recency gives a strong result." })).join()).toContain("truth weight");
    expect(issuesOf(item({ rationale: "There is an 80% chance this is right." })).join()).toContain("truth weight");
    expect(issuesOf(item({ statement: "Recurring revenue is 80% of the total." }))).toEqual([]);
  });

  it("keeps approximate values approximate, unspecified values unexact and ranges as ranges", () => {
    expect(issuesOf(item({ statement: "Revenue was exactly £240,000." })).join()).toContain("as exact");
    expect(issuesOf(item({ statement: "Revenue was precisely 80,000.", references: [{ entityType: "evidence", ref: "E004", role: "primary" }] })).join()).toContain("as exact");
    expect(issuesOf(item({ statement: "The business ran 12.5 projects.", references: [{ entityType: "evidence", ref: "E003", role: "primary" }] })).join()).toContain("midpoint");
    expect(issuesOf(item({ statement: "The business ran between 10 and 15 projects.", references: [{ entityType: "evidence", ref: "E003", role: "primary" }] }))).toEqual([]);
  });
});

describe("Output contract and prompt versions", () => {
  it("is strict, handle-only and versioned", () => {
    expect(PHASE1_DIAGNOSIS_PROMPT_VERSION).toBe("phase1_diagnosis_v1");
    expect(PHASE1_DIAGNOSIS_ARTIFACT_VERSION).toBe("phase1_diagnosis_artifact_v1");
    const schema = JSON.stringify(phase1DiagnosisJsonSchema);
    expect(schema).not.toContain("uuid");
    expect(schema).toContain("^[CEMGD](?:[0-9]{3}|[1-9][0-9]{3,})$");
    expect(schema).not.toContain("priorityRank");
    expect(() => phase1DiagnosisOutputSchema.parse({ items: [] })).toThrow();
    expect(() => phase1DiagnosisOutputSchema.parse({ items: [{ ...item(), truthProbability: 0.9 }] })).toThrow();
    expect(phase1DiagnosisPrompt).toContain("Missing data is not evidence of poor performance");
    expect(phase1DiagnosisPrompt).toContain("Never replace a range with its midpoint");
    expect(phase1DiagnosisPrompt).toContain("strengthScore is only confidence that a relationship type is semantically appropriate");
    expect(phase1DiagnosisPrompt).toContain("Do not perform arithmetic");
  });
});
