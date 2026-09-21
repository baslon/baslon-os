import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  evidenceCoherenceJsonSchema,
  evidenceCoherenceOutputSchema,
  evidenceCoherenceV3OutputSchema,
  type EvidenceCoherenceModelOutput,
} from "@/ai/evidence-coherence/contracts";
import {
  EVIDENCE_COHERENCE_PROMPT_VERSION,
  EVIDENCE_COHERENCE_V3_PROMPT_VERSION,
  evidenceCoherencePrompt,
  evidenceCoherenceV3Prompt,
} from "@/ai/evidence-coherence/prompt";
import {
  EvidenceCoherenceBusinessRuleError,
  validateEvidenceCoherenceOutput,
} from "@/ai/evidence-coherence/validation";
import {
  EVIDENCE_COHERENCE_INPUT_V2_VERSION,
  EVIDENCE_COHERENCE_INPUT_VERSION,
} from "@/domain/evidence-coherence";
import {
  formatHandle,
  handleNamespace,
  resolveHandle,
} from "@/domain/evidence-coherence-handles";
import {
  buildEvidenceCoherenceModelInput,
  buildEvidenceCoherenceProjection,
  hashEvidenceCoherenceModelInput,
  hashEvidenceCoherenceV2Projection,
} from "@/domain/evidence-coherence-projection";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The Snapshot 3/4 profitability-gap Evidence the live model twice failed to reproduce (M4-12).
const profitabilityGapId = "4142656f-8877-447b-86c9-5c0c3e35a58d";
const corruptedEmissions = [
  "414b2656-8877-447b-86c9-5c0c3e35a58d",
  "414b90e2-4593-4e45-9382-f54660270c37",
];

const businessId = "0b0b0b0b-0000-4000-8000-000000000001";
const otherBusinessId = "0b0b0b0b-0000-4000-8000-000000000002";
const ids = {
  claimEarly: "c1000000-0000-4000-8000-000000000003",
  claimLateA: "c1000000-0000-4000-8000-000000000001",
  claimLateB: "c1000000-0000-4000-8000-000000000002",
  claimSuperseded: "c1000000-0000-4000-8000-000000000009",
  revenue: "e1000000-0000-4000-8000-000000000002",
  costGap: "e1000000-0000-4000-8000-000000000001",
  profitabilityGap: profitabilityGapId,
  metricRevenue: "a1000000-0000-4000-8000-000000000001",
};

function claim(id: string, statement: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return { id, businessId, statement, claimType: "observation", subjectArea: "finance", status: "active", supersededByClaimId: null, createdAt, ...extra };
}

function evidenceRecord(id: string, statement: string, createdAt: string, valueNumeric: string | null = null) {
  return {
    id, businessId, statement, createdAt, valueNumeric, valuePrecision: valueNumeric ? "approximate" : null,
    valueLower: null, valueUpper: null, valueText: null, unit: valueNumeric ? "GBP" : null,
    periodStart: null, periodEnd: null, sourceType: "additional_text", sourceReference: "S3",
    reliabilityLevel: "medium", directnessLevel: "direct", recencyLevel: "current", materiality: "high",
  };
}

function snapshotRecords() {
  return {
    claims: [
      claim(ids.claimEarly, "Revenue is approximately £80,000.", "2026-09-20T16:23:12.000Z"),
      claim(ids.claimLateA, "Costs are not tracked.", "2026-09-21T06:50:00.000Z"),
      // Same admission time as claimLateA: the canonical UUID breaks the tie.
      claim(ids.claimLateB, "Profitability is unknown.", "2026-09-21T06:50:00.000Z"),
      claim(ids.claimSuperseded, "Old wording.", "2026-09-19T10:00:00.000Z", { status: "superseded", supersededByClaimId: ids.claimEarly }),
    ],
    evidence: [
      evidenceRecord(ids.revenue, "Total revenue was approximately £80,000.", "2026-09-20T16:23:12.000Z", "80000.0000"),
      evidenceRecord(ids.costGap, "Reliable direct delivery cost figures are unavailable.", "2026-09-21T06:50:00.000Z"),
      evidenceRecord(ids.profitabilityGap, "Reliable figures for founder compensation, profit or loss and cash are unavailable.", "2026-09-21T06:51:00.000Z"),
    ],
    metrics: [{
      id: ids.metricRevenue, businessId, metricKey: "total_revenue", metricLabel: "Total revenue",
      numericValue: "80000.0000", numericPrecision: "approximate", numericLower: null, numericUpper: null,
      unit: "GBP", periodStart: null, periodEnd: null, sourceEvidenceId: ids.revenue, createdAt: "2026-09-20T16:23:12.000Z",
    }],
    claimEvidence: [
      { businessId, claimId: ids.claimLateB, evidenceId: ids.profitabilityGap, relationshipType: "supports", strengthScore: "0.9" },
      { businessId, claimId: ids.claimEarly, evidenceId: ids.revenue, relationshipType: "supports", strengthScore: "0.95" },
      { businessId, claimId: ids.claimLateA, evidenceId: ids.costGap, relationshipType: "supports", strengthScore: "0.9" },
      // Points at a superseded Claim, which has no handle.
      { businessId, claimId: ids.claimSuperseded, evidenceId: ids.revenue, relationshipType: "context", strengthScore: null },
    ],
  };
}

function snapshot(records = snapshotRecords(), version = 4) {
  return {
    id: "5a000000-0000-4000-8000-000000000004",
    businessId,
    version,
    snapshotData: { business: { id: businessId }, profile: { sector: "Digital consultancy" }, ...records },
  };
}

function shuffled(records = snapshotRecords()) {
  return {
    claims: [records.claims[2], records.claims[3], records.claims[0], records.claims[1]],
    evidence: [...records.evidence].reverse(),
    metrics: records.metrics,
    claimEvidence: [...records.claimEvidence].reverse(),
  };
}

function output(references: EvidenceCoherenceModelOutput["gaps"][number]["references"]): EvidenceCoherenceModelOutput {
  return {
    contradictions: [{
      findingRef: "contradiction_1", area: "financial_performance", statement: "Candidate conflict.",
      rationale: "The records disagree.", materiality: "medium", priorityRank: 2,
      references: [
        { entityType: "claim", ref: "C001", role: "primary" },
        { entityType: "evidence", ref: "E001", role: "conflicting" },
      ],
    }],
    gaps: [{
      findingRef: "gap_1", area: "financial_performance", missingInformation: "Profit is unknown.",
      decisionImpact: "Profitability cannot be assessed.", materiality: "high", priorityRank: 1, references,
    }],
    questions: [{ findingType: "gap", findingRef: "gap_1", question: "What was the profit?", priorityOrder: 1 }],
  };
}

describe("M4-12 snapshot-local handle assignment", () => {
  it("assigns C###, E### and M### handles in admission order with the UUID as tie-breaker", () => {
    const { modelInput, references } = buildEvidenceCoherenceModelInput(snapshot());
    expect(modelInput.projectionVersion).toBe("evidence_coherence_input_v3");
    expect(modelInput.snapshot.claims.map((item) => [item.handle, item.statement])).toEqual([
      ["C001", "Revenue is approximately £80,000."],
      ["C002", "Costs are not tracked."],
      ["C003", "Profitability is unknown."],
    ]);
    expect(modelInput.snapshot.evidence.map((item) => item.handle)).toEqual(["E001", "E002", "E003"]);
    expect(modelInput.snapshot.metrics.map((item) => item.handle)).toEqual(["M001"]);
    expect([...references.entries()]).toEqual([
      ["C001", { entityType: "claim", id: ids.claimEarly }],
      ["C002", { entityType: "claim", id: ids.claimLateA }],
      ["C003", { entityType: "claim", id: ids.claimLateB }],
      ["E001", { entityType: "evidence", id: ids.revenue }],
      ["E002", { entityType: "evidence", id: ids.costGap }],
      ["E003", { entityType: "evidence", id: profitabilityGapId }],
      ["M001", { entityType: "metric", id: ids.metricRevenue }],
    ]);
  });

  it("keeps the three namespaces distinct and every handle unique", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    const handles = [...references.keys()];
    expect(new Set(handles).size).toBe(handles.length);
    for (const [handle, reference] of references) {
      expect(handleNamespace(handle)).toBe(reference.entityType);
    }
    expect(formatHandle("claim", 1)).toBe("C001");
    expect(formatHandle("evidence", 13)).toBe("E013");
    expect(formatHandle("metric", 1000)).toBe("M1000");
  });

  it("produces identical handles, model input and hash on repeated and shuffled projection", () => {
    const first = buildEvidenceCoherenceModelInput(snapshot());
    const repeat = buildEvidenceCoherenceModelInput(snapshot());
    const reordered = buildEvidenceCoherenceModelInput(snapshot(shuffled()));
    for (const other of [repeat, reordered]) {
      expect([...other.references.entries()]).toEqual([...first.references.entries()]);
      expect(other.modelInput).toEqual(first.modelInput);
      expect(hashEvidenceCoherenceModelInput(other.modelInput)).toBe(hashEvidenceCoherenceModelInput(first.modelInput));
    }
    // Pinned so an accidental change to the v3 contract cannot pass silently.
    expect(hashEvidenceCoherenceModelInput(first.modelInput))
      .toBe("6c0ba6d4bb4682a41023eba1ee1f5336b8d54f30fd53dc69d644d0b37afbcb3e");
  });

  it("sends no canonical UUID to the model", () => {
    const { modelInput } = buildEvidenceCoherenceModelInput(snapshot());
    const serialized = JSON.stringify(modelInput);
    expect(serialized).not.toMatch(uuidPattern);
    expect(serialized).not.toContain(profitabilityGapId);
    expect(modelInput.snapshot).not.toHaveProperty("businessId");
    expect(modelInput.snapshot).not.toHaveProperty("snapshotId");
  });

  it("expresses relationships and Metric source Evidence as handles", () => {
    const { modelInput } = buildEvidenceCoherenceModelInput(snapshot(shuffled()));
    expect(modelInput.snapshot.relationships).toEqual([
      { claimHandle: "C001", evidenceHandle: "E001", relationshipType: "supports", strengthScore: "0.95" },
      { claimHandle: "C002", evidenceHandle: "E002", relationshipType: "supports", strengthScore: "0.9" },
      { claimHandle: "C003", evidenceHandle: "E003", relationshipType: "supports", strengthScore: "0.9" },
    ]);
    expect(modelInput.snapshot.metrics[0]).toMatchObject({ sourceEvidenceHandle: "E001", numericPrecision: "approximate" });
  });

  it("fails closed on a snapshot record owned by another Business or a duplicated record", () => {
    const foreign = snapshotRecords();
    foreign.evidence[1] = { ...foreign.evidence[1], businessId: otherBusinessId };
    expect(() => buildEvidenceCoherenceModelInput(snapshot(foreign))).toThrow("from another Business");
    const duplicated = snapshotRecords();
    duplicated.evidence.push(duplicated.evidence[0]);
    expect(() => buildEvidenceCoherenceModelInput(snapshot(duplicated))).toThrow("duplicate evidence");
  });
});

describe("M4-12 handle validation and resolution", () => {
  it("resolves a valid handle to its canonical UUID, including the Evidence the model twice corrupted", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    const resolved = validateEvidenceCoherenceOutput(output([
      { entityType: "evidence", ref: "E002", role: "primary" },
      { entityType: "evidence", ref: "E003", role: "primary" },
      { entityType: "metric", ref: "M001", role: "context" },
    ]), references);
    expect(resolved.gaps[0].references).toEqual([
      { recordType: "evidence", recordId: ids.costGap, role: "primary" },
      { recordType: "evidence", recordId: profitabilityGapId, role: "primary" },
      { recordType: "metric", recordId: ids.metricRevenue, role: "context" },
    ]);
    expect(resolved.contradictions[0].references).toEqual([
      { recordType: "claim", recordId: ids.claimEarly, role: "primary" },
      { recordType: "evidence", recordId: ids.revenue, role: "conflicting" },
    ]);
  });

  it("rejects an unknown handle", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    expect(resolveHandle(references, "evidence", "E999")).toEqual({ ok: false, issue: "unknown" });
    expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "evidence", ref: "E999", role: "context" }]), references))
      .toThrow("gap_1 reference evidence:E999 is not in the analysed snapshot");
  });

  it("rejects malformed handles, including any canonical UUID the model emits", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    for (const ref of [profitabilityGapId, ...corruptedEmissions, "E13", "E0013", "e003", "ZZZ", "E", ""]) {
      expect(handleNamespace(ref)).toBeNull();
      expect(resolveHandle(references, "evidence", ref)).toEqual({ ok: false, issue: "malformed" });
      expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "evidence", ref, role: "context" }]), references)).toThrow();
    }
  });

  it("rejects a handle whose namespace does not match the declared entity type", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    expect(resolveHandle(references, "claim", "E003")).toEqual({ ok: false, issue: "wrong_type" });
    expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "claim", ref: "E003", role: "context" }]), references))
      .toThrow("uses a handle outside the declared entity type's namespace");
  });

  it("cannot resolve a record from another snapshot of the same Business", () => {
    const earlier = snapshotRecords();
    earlier.evidence = earlier.evidence.slice(0, 1);
    earlier.claimEvidence = earlier.claimEvidence.filter((item) => item.evidenceId === ids.revenue);
    const snapshotOne = buildEvidenceCoherenceModelInput(snapshot(earlier, 1));
    const snapshotFour = buildEvidenceCoherenceModelInput(snapshot());
    expect(snapshotFour.references.get("E003")?.id).toBe(profitabilityGapId);
    // E003 exists in Snapshot 4 but not in Snapshot 1, whose analysis must not resolve it.
    expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "evidence", ref: "E003", role: "context" }]), snapshotOne.references))
      .toThrow("is not in the analysed snapshot");
  });

  it("cannot resolve a record from another Business", () => {
    const otherRecords = snapshotRecords();
    const other = buildEvidenceCoherenceModelInput({
      ...snapshot({
        claims: otherRecords.claims.map((item) => ({ ...item, businessId: otherBusinessId })),
        evidence: [...otherRecords.evidence, evidenceRecord("e2000000-0000-4000-8000-000000000001", "Other Business evidence.", "2026-09-22T00:00:00.000Z")]
          .map((item) => ({ ...item, businessId: otherBusinessId })),
        metrics: [],
        claimEvidence: [],
      }),
      id: "5b000000-0000-4000-8000-000000000001",
      businessId: otherBusinessId,
    });
    const own = buildEvidenceCoherenceModelInput(snapshot());
    expect(other.references.get("E004")?.id).toBe("e2000000-0000-4000-8000-000000000001");
    expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "evidence", ref: "E004", role: "context" }]), own.references))
      .toThrow("is not in the analysed snapshot");
    // Nor can the other Business's record be cited by UUID.
    expect(() => validateEvidenceCoherenceOutput(output([{ entityType: "evidence", ref: "e2000000-0000-4000-8000-000000000001", role: "context" }]), own.references))
      .toThrow();
  });

  it("rejects the whole output when any one reference is invalid", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    let caught: unknown;
    try {
      validateEvidenceCoherenceOutput(output([
        { entityType: "evidence", ref: "E002", role: "primary" },
        { entityType: "evidence", ref: "E404", role: "context" },
      ]), references);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EvidenceCoherenceBusinessRuleError);
    expect((caught as EvidenceCoherenceBusinessRuleError).issues).toEqual([
      "gap_1 reference evidence:E404 is not in the analysed snapshot",
    ]);
  });
});

describe("M4-12 contract versions", () => {
  it("asks the model for handles only and never for UUIDs", () => {
    expect(EVIDENCE_COHERENCE_PROMPT_VERSION).toBe("evidence_coherence_v4");
    expect(EVIDENCE_COHERENCE_INPUT_VERSION).toBe("evidence_coherence_input_v3");
    const schema = JSON.stringify(evidenceCoherenceJsonSchema);
    expect(schema).not.toContain("uuid");
    expect(schema).toContain("^[CEM](?:[0-9]{3}|[1-9][0-9]{3,})$");
    expect(evidenceCoherencePrompt).toContain("Cite a record only by its handle");
    expect(evidenceCoherencePrompt).toContain("Never invent a handle");
    expect(evidenceCoherencePrompt).not.toContain("canonical Claim, Evidence and Metric IDs");
    expect(() => evidenceCoherenceOutputSchema.parse({
      contradictions: [], questions: [],
      gaps: [{ ...output([]).gaps[0], references: [{ recordType: "evidence", recordId: profitabilityGapId, role: "context" }] }],
    })).toThrow();
  });

  it("keeps the v2 input and v3 prompt/output contracts unchanged for historical runs", () => {
    expect(EVIDENCE_COHERENCE_INPUT_V2_VERSION).toBe("evidence_coherence_input_v2");
    expect(EVIDENCE_COHERENCE_V3_PROMPT_VERSION).toBe("evidence_coherence_v3");
    // Hash of the pre-M4-12 unit fixture, recorded before the change.
    const v2Snapshot = {
      id: "55555555-5555-4555-8555-555555555555",
      businessId: "66666666-6666-4666-8666-666666666666",
      version: 2,
      snapshotData: {
        profile: { services: ["Advisory"] },
        claims: [
          { id: "11111111-1111-4111-8111-111111111111", statement: "Old claim", claimType: "observation", subjectArea: "market", status: "superseded", supersededByClaimId: "22222222-2222-4222-8222-222222222222" },
          { id: "22222222-2222-4222-8222-222222222222", statement: "Active claim", claimType: "observation", subjectArea: "market", status: "active", supersededByClaimId: null },
        ],
        evidence: [{ id: "33333333-3333-4333-8333-333333333333", statement: "Measured result", valueNumeric: "10", valueText: null, unit: "percent", periodStart: null, periodEnd: null, sourceType: "intake", sourceReference: null, reliabilityLevel: "high", directnessLevel: "direct", recencyLevel: "current", materiality: "high" }],
        metrics: [{ id: "44444444-4444-4444-8444-444444444444", metricKey: "conversion", metricLabel: "Conversion", numericValue: "10", unit: "percent", periodStart: null, periodEnd: null, sourceEvidenceId: "33333333-3333-4333-8333-333333333333" }],
        claimEvidence: [{ claimId: "22222222-2222-4222-8222-222222222222", evidenceId: "33333333-3333-4333-8333-333333333333", relationshipType: "context", strengthScore: null }],
      },
    };
    expect(hashEvidenceCoherenceV2Projection(buildEvidenceCoherenceProjection(v2Snapshot)))
      .toBe("d3bb15aaccbacbe9a2625240e3cb3031eff6246792de270c367e0cdbc737866b");
    // Fingerprints of the evidence_coherence_v3 prompt text and output JSON schema, recorded before the change.
    expect(sha256(evidenceCoherenceV3Prompt)).toBe("d7601132e4ddc51ae37523af8e0cb06f5584c015b60c58fc868689f5414984e5");
    expect(sha256(JSON.stringify(z.toJSONSchema(evidenceCoherenceV3OutputSchema))))
      .toBe("945de22380b9bc3bd9a5cacabb86eac5f4e4898a4bbadb0de7713c02477ba5da");
    expect(evidenceCoherenceV3OutputSchema.parse({
      contradictions: [], questions: [],
      gaps: [{ ...output([]).gaps[0], references: [{ recordType: "evidence", recordId: profitabilityGapId, role: "context" }] }],
    })).toBeTruthy();
  });
});
