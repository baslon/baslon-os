import { describe, expect, it } from "vitest";
import {
  diagnosisItemSchema,
  diagnosisItemSchemaV2,
  phase1DiagnosisJsonSchemaV2,
} from "@/ai/phase1-diagnosis/contracts";
import {
  PHASE1_DIAGNOSIS_PROMPT_V1,
  PHASE1_DIAGNOSIS_PROMPT_V2,
  phase1DiagnosisPromptV1,
  phase1DiagnosisPromptV2,
} from "@/ai/phase1-diagnosis/prompt";
import {
  HEADLINE_MAX_LENGTH,
  duplicateHeadlineIssues,
  headlineNumberIssues,
  headlineStructureIssues,
  normaliseHeadline,
  validateHeadline,
} from "@/domain/diagnosis-headline";
import { resolveApprovedHeadlines } from "@/domain/diagnosis-headline-resolution";
import {
  DIAGNOSIS_HEADLINES_INPUT_VERSION,
  DIAGNOSIS_HEADLINES_MODULE,
  DiagnosisHeadlineContractError,
  buildHeadlineProposalInput,
  effectiveApprovedItems,
  effectiveHeadline,
  hashHeadlineProposalInput,
  validateHeadlineProposalOutput,
} from "@/domain/diagnosis-headlines";
import { buildApprovedDiagnosisArtifact, effectiveDiagnosisItem } from "@/domain/phase1-diagnosis-artifact";
import type { DiagnosisReferenceMap } from "@/domain/phase1-diagnosis-handles";
import { parseDiagnosisItem, validatePhase1DiagnosisOutput } from "@/domain/phase1-diagnosis-validation";
import {
  UnsupportedDiagnosisVersionError,
  diagnosisContractForArtifact,
  diagnosisContractForPrompt,
} from "@/domain/phase1-diagnosis-versions";

const v1 = diagnosisContractForPrompt(PHASE1_DIAGNOSIS_PROMPT_V1);
const v2 = diagnosisContractForPrompt(PHASE1_DIAGNOSIS_PROMPT_V2);

const references: DiagnosisReferenceMap = new Map([
  ["E001", { entityType: "evidence", id: "e-1", label: "Revenue evidence", numeric: { precision: "approximate", value: 240000, lower: null, upper: null } }],
  ["G001", { entityType: "gap", id: "g-1", label: "Costs untracked", numeric: null }],
]);

/** A live-shaped v1 item: exactly the eight material fields, with no headline. */
const v1Item = (overrides: Record<string, unknown> = {}) => ({
  itemType: "position",
  statement: "Revenue for the last 12 months was approximately £240,000.",
  rationale: "The revenue evidence states an approximate annual figure.",
  grounding: "evidence_backed",
  materiality: "high",
  interpretationConfidence: null,
  limitations: null,
  references: [{ entityType: "evidence", ref: "E001", role: "primary" }],
  ...overrides,
});

const v2Item = (overrides: Record<string, unknown> = {}) => ({
  headline: "Revenue is approximately £240,000 a year",
  ...v1Item(overrides),
});

describe("Headline rules (deterministic, structural only)", () => {
  it("accepts a plain label and rejects blank, untrimmed, long, multi-line and punctuation-only text", () => {
    expect(headlineStructureIssues("Customer acquisition is not yet predictable")).toEqual([]);
    expect(headlineStructureIssues("   ").join()).toContain("must not be blank");
    expect(headlineStructureIssues("Leading space is wrong ").join()).toContain("whitespace");
    expect(headlineStructureIssues("x".repeat(HEADLINE_MAX_LENGTH + 1)).join()).toContain("at most 120 characters");
    expect(headlineStructureIssues("x".repeat(HEADLINE_MAX_LENGTH))).toEqual([]);
    expect(headlineStructureIssues("Two\nlines").join()).toContain("single line");
    expect(headlineStructureIssues("— … !?").join()).toContain("only punctuation");
  });

  it("allows only numbers the statement already carries", () => {
    const statement = "Recurring revenue is approximately £1,200 per month, about 10% of revenue.";
    expect(headlineNumberIssues("Recurring revenue is about £1,200 a month", statement)).toEqual([]);
    expect(headlineNumberIssues("Recurring revenue is 10% of revenue", statement)).toEqual([]);
    expect(headlineNumberIssues("Recurring revenue could reach £5,000 a month", statement).join()).toContain("introduces the number 5000");
    expect(validateHeadline("Revenue grew 40%", "Revenue was approximately £240,000.").join()).toContain("introduces the number 40");
    expect(validateHeadline("Revenue is approximately £240,000", "Revenue was approximately £240,000.")).toEqual([]);
  });

  it("detects exact duplicates after conservative normalisation only", () => {
    expect(normaliseHeadline("  Pricing   Needs A Decision ")).toBe("pricing needs a decision");
    expect(duplicateHeadlineIssues([
      { label: "I001 headline", headline: "Pricing needs a decision" },
      { label: "I002 headline", headline: "  pricing   NEEDS a decision" },
    ]).join()).toContain("repeats the headline of I001 headline");
    // Different wording of the same idea is a human judgement, never deduplicated here.
    expect(duplicateHeadlineIssues([
      { label: "I001 headline", headline: "Pricing needs a decision" },
      { label: "I002 headline", headline: "A pricing decision is needed" },
    ])).toEqual([]);
  });
});

describe("Phase 1 Diagnosis version dispatch", () => {
  it("selects the contract from persisted provenance and fails closed on anything else", () => {
    expect(v1).toMatchObject({ promptVersion: "phase1_diagnosis_v1", artifactVersion: "phase1_diagnosis_artifact_v1", hasHeadline: false });
    expect(v2).toMatchObject({ promptVersion: "phase1_diagnosis_v2", artifactVersion: "phase1_diagnosis_artifact_v2", hasHeadline: true });
    expect(diagnosisContractForArtifact("phase1_diagnosis_artifact_v1")).toBe(v1);
    expect(diagnosisContractForArtifact("phase1_diagnosis_artifact_v2")).toBe(v2);
    expect(() => diagnosisContractForPrompt("phase1_diagnosis_v3")).toThrow(UnsupportedDiagnosisVersionError);
    expect(() => diagnosisContractForArtifact("phase1_diagnosis_artifact_v9")).toThrow(UnsupportedDiagnosisVersionError);
    expect(v1.reviewFields).toHaveLength(8);
    expect(v2.reviewFields).toHaveLength(9);
  });

  it("keeps v1 exact: a v1 item has no headline, and a v1 correction carrying one is rejected", () => {
    expect(Object.keys(diagnosisItemSchema.shape)).not.toContain("headline");
    expect(parseDiagnosisItem(v1Item(), v1)).toMatchObject({ statement: v1Item().statement });
    expect(parseDiagnosisItem(v1Item(), v1)).not.toHaveProperty("headline");
    expect(() => parseDiagnosisItem(v2Item(), v1)).toThrow();
    expect(validatePhase1DiagnosisOutput({ items: [v1Item()] }, references, v1)).toHaveLength(1);
    // A v1 run's output is still invalid under v2, and vice versa.
    expect(() => validatePhase1DiagnosisOutput({ items: [v1Item()] }, references, v2)).toThrow();
  });

  it("requires a valid headline on every v2 item and rejects duplicates across the output", () => {
    expect(() => parseDiagnosisItem(v1Item(), v2)).toThrow();
    expect(parseDiagnosisItem(v2Item(), v2)).toMatchObject({ headline: "Revenue is approximately £240,000 a year" });
    const issuesOf = (item: Record<string, unknown>) => {
      try {
        validatePhase1DiagnosisOutput({ items: [item] }, references, v2);
        return [];
      } catch (error) {
        return error instanceof DiagnosisHeadlineContractError ? error.issues : [(error as Error).message];
      }
    };
    expect(validatePhase1DiagnosisOutput({ items: [v2Item()] }, references, v2)).toHaveLength(1);
    expect(issuesOf(v2Item({ headline: "x".repeat(121) })).join()).toContain("at most 120 characters");
    expect(issuesOf(v2Item({ headline: "One\ntwo" })).join()).toContain("single line");
    expect(() => validatePhase1DiagnosisOutput({ items: [v2Item({ headline: "   " })] }, references, v2)).toThrow();
    expect(issuesOf(v2Item({ headline: "!!!" })).join()).toContain("only punctuation");
    expect(issuesOf(v2Item({ headline: "Revenue reached £500,000 last year" })).join()).toContain("introduces the number 500000");
    // A headline may not make a verdict the approved statement does not make.
    expect(issuesOf(v2Item({ headline: "The business is unprofitable" })).join()).toContain("negative performance conclusion");
    expect(() => validatePhase1DiagnosisOutput({ items: [v2Item(), v2Item({ statement: "A second statement about revenue of £240,000." })] }, references, v2))
      .toThrow(/repeats the headline/);
  });

  it("publishes a v2 JSON schema that adds the headline and keeps every v1 rule", () => {
    const schema = JSON.stringify(phase1DiagnosisJsonSchemaV2);
    expect(schema).toContain("headline");
    expect(schema).not.toContain("uuid");
    expect(schema).toContain("^[CEMGD](?:[0-9]{3}|[1-9][0-9]{3,})$");
    expect(Object.keys(diagnosisItemSchemaV2.shape)).toEqual(["headline", ...Object.keys(diagnosisItemSchema.shape)]);
    expect(phase1DiagnosisPromptV2.startsWith(phase1DiagnosisPromptV1)).toBe(true);
    expect(phase1DiagnosisPromptV2).toContain("must not introduce any fact, cause or number that is not in the statement");
  });
});

describe("Effective item and artifact by version", () => {
  const baseItem = {
    id: "i-1", itemRef: "I001", itemType: "position", statement: "First.", rationale: "Why.",
    grounding: "evidence_backed", materiality: "high", interpretationConfidence: null, limitations: null,
    references: [{ role: "primary", claimId: null, evidenceId: "e-1", metricId: null, evidenceGapId: null, diagnosisCalculationId: null }],
  };
  const input = (promptVersion: string, items: Array<Record<string, unknown>>, reviews: Array<Record<string, unknown>>) => ({
    businessId: "b-1",
    run: {
      id: "run-1", inputSnapshotId: "s-4", inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion,
      inputHash: "hash", provider: "fake", modelIdentifier: "model", modelConfiguration: { snapshotContentHash: "content" },
    },
    snapshotVersion: 4,
    reviewSessionId: "session-1",
    reviewer: "Reviewer",
    approvedAt: new Date("2026-09-21T11:00:00.000Z"),
    items: items as never,
    reviews: reviews.map((review) => ({ ...review, reason: null, reviewedAt: new Date() })) as never,
    calculations: [],
    gaps: [],
    references,
  });

  it("leaves a v1 approval byte-identical: artifact v1, and no headline key anywhere", () => {
    const { artifactVersion, content } = buildApprovedDiagnosisArtifact(input(
      "phase1_diagnosis_v1",
      [baseItem, { ...baseItem, id: "i-2", itemRef: "I002", statement: "Second." }],
      [
        { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
        { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: v1Item({ statement: "Corrected second." }) },
      ],
    ));
    expect(artifactVersion).toBe("phase1_diagnosis_artifact_v1");
    expect(JSON.stringify(content)).not.toContain("headline");
    expect((content.items as Array<Record<string, unknown>>).map((item) => item.statement)).toEqual(["First.", "Corrected second."]);
  });

  it("carries the effective headline into a v2 artifact: generated when accepted, corrected when corrected", () => {
    const items = [
      { ...baseItem, headline: "Revenue is approximately £240,000 a year" },
      { ...baseItem, id: "i-2", itemRef: "I002", statement: "Second statement about pricing.", headline: "Original AI headline for pricing" },
    ];
    const corrected = v2Item({
      headline: "Pricing needs a decision",
      statement: "Second statement about pricing.",
      itemType: "decision_required",
    });
    const built = input("phase1_diagnosis_v2", items, [
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: corrected },
    ]);
    const { artifactVersion, content } = buildApprovedDiagnosisArtifact(built);
    expect(artifactVersion).toBe("phase1_diagnosis_artifact_v2");
    const artifactItems = content.items as Array<Record<string, unknown>>;
    expect(artifactItems.map((item) => item.headline)).toEqual(["Revenue is approximately £240,000 a year", "Pricing needs a decision"]);
    // The original AI headline stays on the immutable item for audit.
    expect(items[1].headline).toBe("Original AI headline for pricing");
    expect(effectiveDiagnosisItem(items[0], { decision: "ACCEPTED", correctedPayload: null }, references, v2))
      .toMatchObject({ headline: "Revenue is approximately £240,000 a year" });
    expect(effectiveDiagnosisItem(items[0], { decision: "REJECTED", correctedPayload: null }, references, v2)).toBeNull();
    // A v2 item without a headline, or duplicate effective headlines, fail closed.
    expect(() => effectiveDiagnosisItem(baseItem, { decision: "ACCEPTED", correctedPayload: null }, references, v2)).toThrow("without a headline");
    // Two effective items may not carry the same headline.
    expect(() => buildApprovedDiagnosisArtifact(input("phase1_diagnosis_v2", [{ ...items[0], headline: "Shared label" }, items[1]], [
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: { ...corrected, headline: "Shared label" } },
    ]))).toThrow(/repeats the headline/);
  });

  it("fails closed on an unsupported prompt version rather than guessing a contract", () => {
    expect(() => buildApprovedDiagnosisArtifact(input("phase1_diagnosis_v7", [baseItem], [
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
    ]))).toThrow(UnsupportedDiagnosisVersionError);
  });
});

describe("Companion headline proposals for an approved v1 diagnosis", () => {
  const content = {
    artifactVersion: "phase1_diagnosis_artifact_v1",
    items: [
      { itemRef: "I001", diagnosisItemId: "item-1", decision: "ACCEPTED", itemType: "position", statement: "Revenue was approximately £240,000." },
      { itemRef: "I002", diagnosisItemId: "item-2", decision: "CORRECTED", itemType: "limitation", statement: "Profitability cannot be established from the current snapshot." },
    ],
    excludedItems: [{ itemRef: "I003", decision: "REJECTED", reason: "Not supported" }],
  };
  const items = effectiveApprovedItems(content);
  const output = (headlines: Array<{ itemHandle: string; headline: string }>) => ({ headlines });

  it("labels only effective approved items, from a minimal input carrying no canonical record", () => {
    expect(items.map((item) => item.itemRef)).toEqual(["I001", "I002"]);
    const input = buildHeadlineProposalInput(items);
    expect(input).toEqual({
      inputVersion: DIAGNOSIS_HEADLINES_INPUT_VERSION,
      task: "label_approved_diagnosis_items",
      items: [
        { itemHandle: "I001", itemType: "position", statement: "Revenue was approximately £240,000." },
        { itemHandle: "I002", itemType: "limitation", statement: "Profitability cannot be established from the current snapshot." },
      ],
    });
    expect(JSON.stringify(input)).not.toContain("item-1");
    expect(hashHeadlineProposalInput(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(DIAGNOSIS_HEADLINES_MODULE).toBe("diagnosis_headlines");
    // A rejected item can never reach the headline flow.
    expect(() => effectiveApprovedItems({ items: [{ ...content.items[0], decision: "REJECTED" }] })).toThrow(DiagnosisHeadlineContractError);
  });

  it("requires exactly one valid headline per item and rejects the whole output otherwise", () => {
    const valid = output([
      { itemHandle: "I001", headline: "Revenue is approximately £240,000 a year" },
      { itemHandle: "I002", headline: "Profitability cannot yet be established" },
    ]);
    expect(validateHeadlineProposalOutput(valid, items).map((proposal) => proposal.headline))
      .toEqual(["Revenue is approximately £240,000 a year", "Profitability cannot yet be established"]);
    const issuesOf = (value: unknown) => {
      try {
        validateHeadlineProposalOutput(value, items);
        return "";
      } catch (error) {
        return error instanceof DiagnosisHeadlineContractError ? error.issues.join("; ") : (error as Error).message;
      }
    };
    expect(issuesOf(output([valid.headlines[0]]))).toContain("I002 has no proposed headline");
    expect(issuesOf(output([...valid.headlines, { itemHandle: "I009", headline: "Unknown item" }]))).toContain("I009 is not an item");
    expect(issuesOf(output([...valid.headlines, { itemHandle: "I001", headline: "Another label for the same item" }])))
      .toContain("I001 has more than one proposed headline");
    expect(issuesOf(output([
      { itemHandle: "I001", headline: "Revenue reached £500,000" },
      valid.headlines[1],
    ]))).toContain("introduces the number 500000");
    expect(issuesOf(output([
      { itemHandle: "I001", headline: "Same label" },
      { itemHandle: "I002", headline: "same   LABEL" },
    ]))).toContain("repeats the headline");
    expect(issuesOf(output([{ itemHandle: "I001", headline: "One\ntwo" }, valid.headlines[1]]))).toContain("single line");
    // A malformed payload never becomes a partial proposal set.
    expect(issuesOf({ headlines: [{ itemHandle: "I001" }] })).toBeTruthy();
  });

  it("takes the correction as the final headline and the proposal when accepted", () => {
    expect(effectiveHeadline({ headline: "Proposed" }, { decision: "ACCEPTED", correctedHeadline: null })).toBe("Proposed");
    expect(effectiveHeadline({ headline: "Proposed" }, { decision: "CORRECTED", correctedHeadline: "Corrected" })).toBe("Corrected");
    expect(() => effectiveHeadline({ headline: "Proposed" }, { decision: "CORRECTED", correctedHeadline: null })).toThrow();
    expect(() => effectiveHeadline({ headline: "Proposed" }, { decision: "REJECTED", correctedHeadline: null })).toThrow();
  });
});

describe("Headline resolution for the approved diagnosis views", () => {
  const approvedV1 = { id: "approved-1", version: 1, analysisRunId: "run-1", artifactVersion: "phase1_diagnosis_artifact_v1", content: { items: [{ itemRef: "I001" }] } };
  const companion = {
    id: "set-1", businessId: "b-1", approvedDiagnosisId: "approved-1", approvedDiagnosisVersion: 1,
    diagnosisRunId: "run-1", version: 2, approvedBy: "Reviewer", approvedAt: new Date("2026-09-23T10:00:00.000Z"),
    headlines: [{ itemRef: "I001", headline: "Revenue is approximately £240,000 a year" }],
  };

  it("prefers a native v2 headline, then an exactly bound companion set, then none", () => {
    const native = resolveApprovedHeadlines({
      businessId: "b-1",
      approved: { ...approvedV1, artifactVersion: "phase1_diagnosis_artifact_v2", content: { items: [{ itemRef: "I001", headline: "Native headline" }] } },
      companion,
    });
    expect(native).toMatchObject({ source: "native", byItemRef: { I001: "Native headline" } });

    expect(resolveApprovedHeadlines({ businessId: "b-1", approved: approvedV1, companion }))
      .toMatchObject({ source: "companion", setId: "set-1", setVersion: 2, byItemRef: { I001: "Revenue is approximately £240,000 a year" } });

    expect(resolveApprovedHeadlines({ businessId: "b-1", approved: approvedV1 })).toEqual({ source: "none", byItemRef: {} });
  });

  it("ignores a headline set bound to another diagnosis, version, run or Business", () => {
    const stale = [
      { ...companion, approvedDiagnosisId: "approved-2" },
      { ...companion, approvedDiagnosisVersion: 2 },
      { ...companion, diagnosisRunId: "run-2" },
      { ...companion, businessId: "b-2" },
    ];
    for (const set of stale) {
      expect(resolveApprovedHeadlines({ businessId: "b-1", approved: approvedV1, companion: set }))
        .toEqual({ source: "none", byItemRef: {} });
    }
  });
});
