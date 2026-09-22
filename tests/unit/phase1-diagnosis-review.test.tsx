import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diagnosisItemSchema } from "@/ai/phase1-diagnosis/contracts";
import { diagnosisItems } from "@/db/schema";
import { REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE } from "@/domain/phase1-diagnosis";
import { buildApprovedDiagnosisArtifact, effectiveDiagnosisItem } from "@/domain/phase1-diagnosis-artifact";
import type { DiagnosisReferenceMap } from "@/domain/phase1-diagnosis-handles";
import {
  diagnosisReviewFields,
  formatReferenceLines,
  parseReferenceLines,
} from "@/domain/phase1-diagnosis-review-card";
import type { DiagnosisDisplayItem, DiagnosisViewModel } from "@/services/phase1-diagnosis-service";
import { Phase1Diagnosis, formatApprovalTime } from "../../app/phase1-diagnosis";
import { formatCalculationValue, parseDiagnosisView } from "../../app/phase1-diagnosis-approved";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll("\"", "&quot;");

function model(overrides: Partial<DiagnosisViewModel> = {}): DiagnosisViewModel {
  return {
    business: { id: "business", name: "Synthetic Co (synthetic test)", status: "active" },
    workflowState: "PHASE1_AWAITING_REVIEW",
    snapshot: { id: "snapshot-4", version: 4 },
    run: {
      id: "run-1", status: "SUCCEEDED", inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v1",
      inputHash: "hash-abc", provider: "fake", modelIdentifier: "model-x", snapshotContentHash: "content-hash-123",
      createdAt: "2026-09-21T10:00:00.000Z", completedAt: "2026-09-21T10:00:20.000Z",
    },
    gaps: [{ handle: "G001", area: "financial_performance", materiality: "high", missingInformation: "Costs are untracked.", decisionImpact: "Limits profit analysis." }],
    calculations: [{
      handle: "D001", label: "Annualised run-rate of Recurring revenue", formula: "M001 × 12. A run-rate, not realised revenue.",
      ruleKey: "annualised_run_rate", ruleVersion: "v1", valueNumeric: "14400.0000", valuePrecision: "approximate",
      valueLower: null, valueUpper: null, unit: "GBP per year", sources: ["M001"],
    }],
    items: [
      {
        id: "item-1", itemRef: "I001", itemType: "decision_required", statement: "Pricing strategy needs a decision.",
        rationale: "The rationale shown exactly.", grounding: "interpretive", materiality: "medium", interpretationConfidence: "low",
        limitations: "Profit data is untracked.",
        references: [
          { handle: "E001", entityType: "evidence", role: "context", label: "Revenue was approximately £240,000." },
          { handle: "G001", entityType: "gap", role: "limiting_gap", label: "Costs are untracked." },
        ],
        decision: null,
        effective: null,
      },
      {
        id: "item-2", itemRef: "I002", itemType: "position", statement: "Revenue is approximately £240,000.",
        rationale: "Stated in evidence.", grounding: "evidence_backed", materiality: "high", interpretationConfidence: null,
        limitations: null, references: [{ handle: "E001", entityType: "evidence", role: "primary", label: "Revenue was approximately £240,000." }],
        decision: { decision: "ACCEPTED", reason: null, correctedPayload: null },
        effective: {
          itemType: "position", statement: "Revenue is approximately £240,000.", rationale: "Stated in evidence.",
          grounding: "evidence_backed", materiality: "high", interpretationConfidence: null, limitations: null,
          references: [{ handle: "E001", entityType: "evidence", role: "primary", label: "Revenue was approximately £240,000." }],
        },
      },
    ],
    session: { id: "session-1", reviewerId: "Reviewer", status: "OPEN" },
    approved: null,
    ...overrides,
  };
}

type ViewItem = DiagnosisViewModel["items"][number];

/** The generated material fields of an item, as the effective item of an ACCEPTED decision. */
function generated(entry: ViewItem): DiagnosisDisplayItem {
  const { itemType, statement, rationale, grounding, materiality, interpretationConfidence, limitations, references } = entry;
  return { itemType, statement, rationale, grounding, materiality, interpretationConfidence, limitations, references };
}

/** Mirrors the service: a decided item carries its effective item (null when REJECTED). */
function decide(entry: ViewItem, decision: "ACCEPTED" | "CORRECTED" | "REJECTED", corrected?: DiagnosisDisplayItem, reason: string | null = null): ViewItem {
  return {
    ...entry,
    decision: { decision, reason, correctedPayload: corrected ? { ...corrected } : null },
    effective: decision === "REJECTED" ? null : decision === "CORRECTED" ? corrected! : generated(entry),
  };
}

describe("Diagnosis review surface completeness (M4-07)", () => {
  it("keeps the review manifest equal to the output contract and the persisted item columns", () => {
    const manifest = diagnosisReviewFields.map((entry) => entry.field).toSorted();
    expect(manifest).toEqual(Object.keys(diagnosisItemSchema.shape).toSorted());
    const infrastructure = new Set(["id", "businessId", "analysisRunId", "itemRef", "createdAt"]);
    const persisted = Object.keys(getTableColumns(diagnosisItems)).filter((column) => !infrastructure.has(column));
    // References persist in diagnosis_item_references and are shown as their own field.
    expect([...persisted, "references"].toSorted()).toEqual(manifest);
  });

  it("renders every material field with its exact value, plus definitions, gaps, calculations and read-only provenance", () => {
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model() }));
    for (const { label } of diagnosisReviewFields) expect(html).toContain(label);
    const [item] = model().items;
    for (const value of [item.statement, item.rationale, item.limitations!, "decision required", "interpretive", "medium", "low"]) {
      expect(html).toContain(escape(value));
    }
    for (const reference of item.references) {
      expect(html).toContain(`<code>${reference.handle}</code>`);
      expect(html).toContain(escape(reference.label));
    }
    expect(html).toContain("limiting gap");
    expect(html).toContain("AI interpretation, not fact");
    expect(html).toContain("It does not mean the statement is true");
    expect(html).toContain("not the probability that anything is true");
    expect(html).toContain("Not given");
    expect(html).toContain("None stated");
    expect(html).toContain("Known evidence gaps carried forward");
    expect(html).toContain("Missing data is not evidence of poor performance");
    expect(html).toContain("calculated, not founder-supplied evidence");
    expect(html).toContain("14400.0000 GBP per year (precision: approximate)");
    expect(html).toContain("Provenance (recorded by Baslon OS, read-only)");
    for (const value of ["content-hash-123", "hash-abc", "phase1_diagnosis_input_v1", "phase1_diagnosis_v1", "fake / model-x"]) {
      expect(html).toContain(value);
    }
  });

  it("offers ACCEPT / CORRECT / REJECT for undecided items and blocks approval until every item is decided", () => {
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model() }));
    expect(html).toContain('value="ACCEPTED"');
    expect(html).toContain('value="REJECTED"');
    expect(html).toContain('value="CORRECTED"');
    expect(html).toContain("Correct this item");
    expect(html).toContain('name="grounding"');
    expect(html).toContain('name="references"');
    expect(html).toContain("primary E001");
    expect(html).toContain("Decision: ACCEPTED");
    expect(html).toContain("Decide every item (accept, correct or reject) before approving.");
    expect(html).not.toContain("Approve diagnosis</button>");

    const mixed = model({ items: model().items.map((entry, index) => decide(entry, index === 0 ? "REJECTED" : "ACCEPTED")) });
    expect(renderToStaticMarkup(createElement(Phase1Diagnosis, { model: mixed }))).toContain("Approve diagnosis</button>");
  });

  it("does not offer approval when every item was rejected, and points to revision", () => {
    const allRejected = model({ items: model().items.map((entry) => decide(entry, "REJECTED", undefined, "No")) });
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: allRejected }));
    expect(html).not.toContain("Approve diagnosis</button>");
    expect(html).toContain("Every item was rejected, so this diagnosis cannot be approved");
    expect(html).toContain("Request a revised diagnosis");
  });

  it("offers a human-initiated run only when ready, and shows no decision forms after approval", () => {
    const ready = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model({ workflowState: "PHASE1_READY", run: null, items: [], session: null }) }));
    expect(ready).toContain("Run Phase 1 Diagnosis");
    const failed = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model({ workflowState: "PHASE1_ANALYSING", run: { ...model().run!, status: "FAILED" }, items: [], session: null }) }));
    expect(failed).toContain("Retry diagnosis");
    const approved = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model({
      workflowState: "PHASE1_APPROVED",
      session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" },
      approved: { id: "approved-1", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-21T11:00:00.000Z", content: {
        semantics: "Approval accepts this diagnosis as the current analytical basis.",
        decisions: { ACCEPTED: 1, CORRECTED: 0, REJECTED: 1 },
        items: [{ itemRef: "I002", decision: "ACCEPTED", itemType: "position", statement: "Revenue is approximately £240,000.", grounding: "evidence_backed", materiality: "high" }],
        excludedItems: [{ itemRef: "I001", reason: "No" }],
      } },
    }) }));
    expect(approved).toContain("Phase 1 Diagnosis — Approved");
    expect(approved).toContain("Version 1");
    expect(approved).not.toContain('value="ACCEPTED"');
    expect(approved).not.toContain("Run Phase 1 Diagnosis");
  });

  it("in REVISION_REQUIRED explains that a newer snapshot is needed, offers Add Information and never Run (v1)", () => {
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model({
      workflowState: "REVISION_REQUIRED",
      items: model().items.map((entry) => decide(entry, "REJECTED", undefined, "No")),
    }) }));
    expect(html).toContain(escape(REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE));
    expect(html).toContain('href="/businesses/business/information"');
    expect(html).not.toContain("Run Phase 1 Diagnosis");
    expect(html).not.toContain("Retry diagnosis");
    expect(html).not.toContain("<form");
    // The diagnosis sent for revision stays visible, read-only.
    expect(html).toContain("Pricing strategy needs a decision.");
    expect(html).not.toContain('value="ACCEPTED"');
    expect(html).not.toContain("Approve diagnosis</button>");
    expect(html).not.toContain("Request a revised diagnosis");
  });
});

describe("Reviewer reference editing", () => {
  it("round-trips valid lines and keeps malformed ones visible to validation", () => {
    expect(parseReferenceLines("primary E001\nlimiting_gap G002\ncontext D001")).toEqual([
      { entityType: "evidence", ref: "E001", role: "primary" },
      { entityType: "gap", ref: "G002", role: "limiting_gap" },
      { entityType: "calculation", ref: "D001", role: "context" },
    ]);
    expect(formatReferenceLines([{ role: "primary", handle: "E001" }])).toBe("primary E001");
    const [unknownRole] = parseReferenceLines("supports E001");
    expect(unknownRole.ref).toBe("supports E001");
    const [uuidRef] = parseReferenceLines("primary 4142656f-8877-447b-86c9-5c0c3e35a58d");
    expect(uuidRef.ref).toContain("4142656f");
  });
});

describe("Approved artifact builder", () => {
  const references: DiagnosisReferenceMap = new Map([
    ["E001", { entityType: "evidence", id: "e-1", label: "Revenue evidence", numeric: { precision: "approximate", value: 240000, lower: null, upper: null } }],
    ["G001", { entityType: "gap", id: "g-1", label: "Costs untracked", numeric: null }],
    ["M001", { entityType: "metric", id: "m-1", label: "Recurring", numeric: { precision: "approximate", value: 1200, lower: null, upper: null } }],
    ["D001", { entityType: "calculation", id: "d-1", label: "Run-rate", numeric: { precision: "approximate", value: 14400, lower: null, upper: null } }],
  ]);
  const baseItem = {
    itemType: "position", rationale: "Why.", grounding: "evidence_backed", materiality: "high",
    interpretationConfidence: null, limitations: null,
    references: [{ role: "primary", claimId: null, evidenceId: "e-1", metricId: null, evidenceGapId: null, diagnosisCalculationId: null }],
  };
  const input = (reviews: Array<{ diagnosisItemId: string; decision: string; correctedPayload: Record<string, unknown> | null }>) => ({
    businessId: "b-1",
    run: {
      id: "run-1", inputSnapshotId: "s-4", inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v1",
      inputHash: "hash", provider: "fake", modelIdentifier: "model", modelConfiguration: { snapshotContentHash: "content" },
    },
    snapshotVersion: 4,
    reviewSessionId: "session-1",
    reviewer: "Reviewer",
    approvedAt: new Date("2026-09-21T11:00:00.000Z"),
    items: [
      { ...baseItem, id: "i-2", itemRef: "I002", statement: "Second." },
      { ...baseItem, id: "i-1", itemRef: "I001", statement: "First." },
      { ...baseItem, id: "i-3", itemRef: "I003", statement: "Third." },
    ],
    reviews: reviews.map((review) => ({ ...review, reason: null, reviewedAt: new Date() })),
    calculations: [{
      id: "d-1", calculationRef: "D001", ruleKey: "annualised_run_rate", ruleVersion: "v1", label: "Run-rate", formula: "M001 × 12",
      valueNumeric: "14400.0000", valuePrecision: "approximate", valueLower: null, valueUpper: null, unit: "GBP per year",
      sources: [{ metricId: "m-1", evidenceId: null }],
    }],
    gaps: [{ id: "g-1", analysisRunId: "c-1", area: "financial_performance", missingInformation: "Costs untracked", decisionImpact: "Limits", materiality: "high", priorityRank: 1, handle: "G001" }],
    references,
  });

  it("excludes REJECTED items, incorporates validated CORRECTED values and always carries the gaps", () => {
    const corrected = {
      itemType: "limitation", statement: "Profit cannot be established.", rationale: "Costs untracked.", grounding: "interpretive",
      materiality: "high", interpretationConfidence: null, limitations: "No cost data.", references: [{ entityType: "gap", ref: "G001", role: "limiting_gap" }],
    };
    const { artifactVersion, content } = buildApprovedDiagnosisArtifact(input([
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: corrected },
      { diagnosisItemId: "i-3", decision: "REJECTED", correctedPayload: null },
    ]));
    expect(artifactVersion).toBe("phase1_diagnosis_artifact_v1");
    const items = content.items as Array<Record<string, unknown>>;
    expect(items.map((entry) => entry.itemRef)).toEqual(["I001", "I002"]);
    expect(items[1]).toMatchObject({ decision: "CORRECTED", statement: "Profit cannot be established.", grounding: "interpretive" });
    expect(items[0].references).toEqual([{ entityType: "evidence", handle: "E001", role: "primary", id: "e-1", label: "Revenue evidence" }]);
    expect(content.excludedItems).toEqual([expect.objectContaining({ itemRef: "I003" })]);
    expect(content.carriedForwardGaps).toEqual([expect.objectContaining({ handle: "G001", id: "g-1" })]);
    expect(content.calculations).toEqual([expect.objectContaining({ derived: true, sources: [{ entityType: "metric", id: "m-1", handle: "M001" }] })]);
  });

  it("refuses a correction that fails validation or an item without a decision", () => {
    expect(() => buildApprovedDiagnosisArtifact(input([
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: { ...baseItem, statement: "The business is unprofitable.", references: [{ entityType: "gap", ref: "G001", role: "limiting_gap" }] } },
      { diagnosisItemId: "i-3", decision: "REJECTED", correctedPayload: null },
    ]))).toThrow();
    expect(() => buildApprovedDiagnosisArtifact(input([{ diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null }])))
      .toThrow("has no valid decision");
  });

  it("uses one effective-item function: artifact items equal effectiveDiagnosisItem, REJECTED is null, and corrections are revalidated (M4-13)", () => {
    const corrected = {
      itemType: "limitation", statement: "Profit cannot be established.", rationale: "Costs untracked.", grounding: "interpretive",
      materiality: "high", interpretationConfidence: "medium", limitations: "No cost data.", references: [{ entityType: "gap", ref: "G001", role: "limiting_gap" }],
    };
    const reviews = [
      { diagnosisItemId: "i-1", decision: "ACCEPTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "CORRECTED", correctedPayload: corrected },
      { diagnosisItemId: "i-3", decision: "REJECTED", correctedPayload: null },
    ];
    const built = input(reviews);
    const artifactItems = buildApprovedDiagnosisArtifact(built).content.items as Array<Record<string, unknown>>;
    const effective = (itemId: string) => effectiveDiagnosisItem(
      built.items.find((entry) => entry.id === itemId)!, reviews.find((review) => review.diagnosisItemId === itemId)!, references,
    );
    const { itemRef: acceptedRef, diagnosisItemId: acceptedId, decision: acceptedDecision, reason: acceptedReason, ...acceptedFields } = artifactItems[0];
    const { itemRef: correctedRef, diagnosisItemId: correctedId, decision: correctedDecision, reason: correctedReason, ...correctedFields } = artifactItems[1];
    expect([acceptedRef, acceptedId, acceptedDecision, acceptedReason, correctedRef, correctedId, correctedDecision, correctedReason])
      .toEqual(["I001", "i-1", "ACCEPTED", null, "I002", "i-2", "CORRECTED", null]);
    expect(acceptedFields).toEqual(effective("i-1"));
    expect(correctedFields).toEqual(effective("i-2"));
    expect(effective("i-2")).toMatchObject({ grounding: "interpretive", limitations: "No cost data.", interpretationConfidence: "medium", references: [{ handle: "G001", role: "limiting_gap", id: "g-1", label: "Costs untracked" }] });
    expect(effective("i-1")).toMatchObject({ statement: "First.", grounding: "evidence_backed", references: [{ handle: "E001", id: "e-1" }] });
    expect(effective("i-3")).toBeNull();
    // A stored correction that no longer resolves fails closed for the page and for approval alike.
    const unknownReference = { ...corrected, references: [{ entityType: "gap", ref: "G009", role: "limiting_gap" }] };
    expect(() => effectiveDiagnosisItem(built.items[0], { decision: "CORRECTED", correctedPayload: unknownReference }, references)).toThrow();
  });

  it("refuses to build an artifact from an all-rejected review", () => {
    expect(() => buildApprovedDiagnosisArtifact(input([
      { diagnosisItemId: "i-1", decision: "REJECTED", correctedPayload: null },
      { diagnosisItemId: "i-2", decision: "REJECTED", correctedPayload: null },
      { diagnosisItemId: "i-3", decision: "REJECTED", correctedPayload: null },
    ]))).toThrow("at least one accepted or corrected item");
  });
});

describe("Final reviewed item surface (M4-13)", () => {
  const ref = (handle: string, role: string, entityType = handle.startsWith("C") ? "claim" : handle.startsWith("E") ? "evidence" : "gap") =>
    ({ handle, entityType, role, label: `${handle} label` });
  const proposal = (itemRef: string, fields: Partial<ViewItem>): ViewItem => ({
    id: `item-${itemRef}`, itemRef, itemType: "risk", statement: `${itemRef} generated statement.`, rationale: `${itemRef} generated rationale.`,
    grounding: "evidence_backed", materiality: "high", interpretationConfidence: null, limitations: `${itemRef} generated limitation.`,
    references: [ref("C001", "primary")], decision: null, effective: null, ...fields,
  });
  // Shapes of the three live defects (I002 limitations, I006 references, I014 grounding), plus an accepted and a rejected item.
  const i002 = proposal("I002", { limitations: "The figure excludes phone enquiries and does not establish the resulting sales, revenue or profitability for Swift Trees." });
  const i006 = proposal("I006", { references: [ref("C034", "primary"), ref("C035", "primary"), ref("C036", "primary"), ref("C037", "primary"), ref("E054", "context"), ref("E055", "context"), ref("E056", "context"), ref("E057", "context")] });
  const i014 = proposal("I014", { itemType: "decision_required", grounding: "hypothesis", interpretationConfidence: "medium", statement: "The business has not yet resolved which proposition to use." });
  const correctedI002 = { ...generated(i002), limitations: "The figure excludes phone enquiries and does not establish that Baslon Digital's work alone caused the enquiry volume, or establish the resulting sales, revenue or profitability." };
  const correctedI006 = { ...generated(i006), references: i006.references.filter((entry) => entry.handle !== "C034") };
  const correctedI014 = { ...generated(i014), grounding: "interpretive", statement: "A key strategic decision is which acquisition channel and ideal-customer proposition should be used as the basis for a repeatable growth model." };
  const reviewed = model({ items: [
    decide(proposal("I003", { statement: "An accepted generated statement." }), "ACCEPTED"),
    decide(i002, "CORRECTED", correctedI002, "Make the causal limitation explicit."),
    decide(proposal("I005", { statement: "A rejected statement." }), "REJECTED", undefined, "Not supported."),
    decide(i006, "CORRECTED", correctedI006),
    decide(i014, "CORRECTED", correctedI014),
  ] });
  const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: reviewed }));

  function section(itemRef: string, name: "effective" | "original") {
    const start = html.indexOf(`aria-label="Diagnosis item ${itemRef}"`);
    const article = html.slice(start, html.indexOf("</article>", start));
    const pattern = name === "effective"
      ? /<section data-section="effective"[^>]*>([\s\S]*?)<\/section>/
      : /<details class="original-item" data-section="original">([\s\S]*?)<\/details>/;
    return article.match(pattern)?.[1] ?? null;
  }
  const field = (fragment: string | null, name: string) =>
    fragment?.match(new RegExp(`data-field="${name}"><dt>[^<]*</dt><dd>([\\s\\S]*?)</dd>`))?.[1] ?? null;

  it("renders an ACCEPTED item's generated values as the final values, with no duplicate original section", () => {
    const effective = section("I003", "effective");
    expect(effective).toContain("An accepted generated statement.");
    expect(field(effective, "grounding")).toContain("evidence backed");
    expect(section("I003", "original")).toBeNull();
    expect(html).toContain("The generated item is accepted unchanged.");
  });

  it("renders a CORRECTED statement as the final statement (I014)", () => {
    expect(field(section("I014", "effective"), "statement")).toBe(escape(correctedI014.statement));
  });

  it("renders CORRECTED limitations as the final limitations (I002)", () => {
    expect(field(section("I002", "effective"), "limitations")).toBe(escape(correctedI002.limitations));
  });

  it("renders CORRECTED grounding as the final grounding (I014)", () => {
    expect(field(section("I014", "effective"), "grounding")).toMatch(/^interpretive /);
  });

  it("renders CORRECTED references as the final references (I006)", () => {
    const references = field(section("I006", "effective"), "references")!;
    for (const handle of ["C035", "C036", "C037", "E054", "E055", "E056", "E057"]) expect(references).toContain(`<code>${handle}</code>`);
    expect(references).not.toContain("<code>C034</code>");
    expect(references).not.toContain("<code>C033</code>");
  });

  it("keeps original values out of the final section", () => {
    expect(section("I002", "effective")).not.toContain(escape(i002.limitations!));
    expect(section("I014", "effective")).not.toContain(escape(i014.statement));
    expect(field(section("I014", "effective"), "grounding")).not.toMatch(/^hypothesis /);
  });

  it("keeps the original AI item only in a clearly labelled, collapsed audit section", () => {
    expect(html).toContain("Original AI diagnosis item (audit, read-only)");
    expect(field(section("I006", "original"), "references")).toContain("<code>C034</code>");
    expect(field(section("I014", "original"), "grounding")).toMatch(/^hypothesis /);
    expect(section("I002", "original")).toContain(escape(i002.limitations!));
    expect(html).not.toMatch(/<details class="original-item" data-section="original" open/);
  });

  it("marks a REJECTED item as excluded from the approved diagnosis", () => {
    expect(section("I005", "effective")).toBeNull();
    expect(html).toContain("Decision: REJECTED</strong> — Not supported. This item will not be included in the approved diagnosis.");
    expect(section("I005", "original")).toContain("A rejected statement.");
  });

  it("shows the approval statement only when the diagnosis can be approved", () => {
    const statement = "You are approving the final reviewed diagnosis shown above.";
    expect(html).toContain(statement);
    expect(html).toContain("Approve diagnosis</button>");
    expect(renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model() }))).not.toContain(statement);
    const allRejected = model({ items: model().items.map((entry) => decide(entry, "REJECTED")) });
    expect(renderToStaticMarkup(createElement(Phase1Diagnosis, { model: allRejected }))).not.toContain(statement);
    const completed = model({ ...reviewed, workflowState: "PHASE1_APPROVED", session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" } });
    expect(renderToStaticMarkup(createElement(Phase1Diagnosis, { model: completed }))).not.toContain(statement);
  });
});

describe("Approved diagnosis information architecture", () => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const handle = /\b[CEMGD]\d{3}\b/;
  const ref = (handle: string, role: string, entityType: string, label: string, n: number) =>
    ({ entityType, handle, role, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, label });
  const finding = (itemRef: string, itemType: string, statement: string, extra: Record<string, unknown> = {}) => ({
    itemRef, diagnosisItemId: `item-${itemRef}`, decision: "ACCEPTED", reason: null, itemType, statement,
    rationale: `${itemRef} rationale text.`, grounding: "evidence_backed", materiality: "high", interpretationConfidence: null,
    limitations: `${itemRef} limitation text.`, references: [ref("C001", "primary", "claim", "Claim one label", 1), ref("E002", "context", "evidence", "Evidence two label", 2)],
    ...extra,
  });
  const items = [
    finding("I001", "position", "The business positions itself for established service firms.", { decision: "CORRECTED", reason: "Preserve source meaning" }),
    finding("I002", "strength", "A documented client outcome exists."),
    finding("I003", "strength", "Recurring revenue is present.", { materiality: "medium" }),
    finding("I004", "constraint", "Acquisition lacks predictability."),
    finding("I005", "risk", "Recurring revenue is concentrated."),
    finding("I006", "opportunity", "Enquiry capability may be valuable.", { grounding: "interpretive", interpretationConfidence: "medium" }),
    finding("I007", "limitation", "Profitability cannot be established.", { grounding: "interpretive", interpretationConfidence: "high", references: [ref("G001", "limiting_gap", "gap", "Costs untracked", 3)] }),
    finding("I008", "limitation", "Channel economics cannot be quantified.", { grounding: "interpretive", interpretationConfidence: "high" }),
    finding("I009", "decision_required", "A key strategic decision is which channel to build on.", { decision: "CORRECTED", reason: "Frame as a decision", grounding: "interpretive", interpretationConfidence: "medium" }),
  ];
  const gaps = [
    { handle: "G001", id: "00000000-0000-4000-8000-000000000101", analysisRunId: "00000000-0000-4000-8000-000000000900", area: "financial_performance", materiality: "high", missingInformation: "Costs untracked.", decisionImpact: "Profitability cannot be assessed." },
    { handle: "G002", id: "00000000-0000-4000-8000-000000000102", analysisRunId: "00000000-0000-4000-8000-000000000900", area: "sales_and_conversion", materiality: "high", missingInformation: "No pipeline history.", decisionImpact: "Conversion cannot be assessed." },
    { handle: "G003", id: "00000000-0000-4000-8000-000000000103", analysisRunId: "00000000-0000-4000-8000-000000000900", area: "customers_and_market", materiality: "medium", missingInformation: "No segment data.", decisionImpact: "Segments cannot be compared." },
  ];
  const calculations = [
    { handle: "D001", id: "00000000-0000-4000-8000-000000000201", derived: true, ruleKey: "annualised_run_rate", ruleVersion: "v1", label: "Annualised run-rate of Recurring revenue", formula: "M002 × 12. The monthly rate annualised; a run-rate, not realised revenue for any period.", valueNumeric: "14400.0000", valuePrecision: "approximate", valueLower: null, valueUpper: null, unit: "GBP per year", sources: [{ entityType: "metric", id: "00000000-0000-4000-8000-000000000301", handle: "M002" }] },
    { handle: "D002", id: "00000000-0000-4000-8000-000000000202", derived: true, ruleKey: "annualised_run_rate", ruleVersion: "v1", label: "Annualised run-rate of Initial period revenue", formula: "M014 × 12.", valueNumeric: "7200.0000", valuePrecision: "approximate", valueLower: null, valueUpper: null, unit: "GBP per year", sources: [{ entityType: "metric", id: "00000000-0000-4000-8000-000000000302", handle: "M014" }] },
  ];
  const content = {
    artifactVersion: "phase1_diagnosis_artifact_v1", semantics: "Approval accepts this diagnosis as the current analytical basis for the next strategic phase.",
    analysisRunId: "run-1", reviewSessionId: "session-1", snapshot: { id: "snapshot-4", version: 4, contentHash: "content-hash-123" },
    inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v1", inputHash: "hash-abc", provider: "fake", model: "model-x",
    reviewer: "Reviewer", decisions: { ACCEPTED: 7, CORRECTED: 2, REJECTED: 0 }, items, excludedItems: [], calculations, carriedForwardGaps: gaps,
  };
  // Originals for the audit view: the corrected items had different AI statements.
  const reviewItems: ViewItem[] = items.map((item) => ({
    id: `item-${item.itemRef}`, itemRef: item.itemRef, itemType: item.itemType,
    statement: item.decision === "CORRECTED" ? `ORIGINAL AI statement for ${item.itemRef}.` : item.statement,
    rationale: item.rationale, grounding: item.itemRef === "I009" ? "hypothesis" : item.grounding, materiality: item.materiality,
    interpretationConfidence: item.interpretationConfidence, limitations: item.limitations,
    references: item.references.map(({ handle, entityType, role, label }) => ({ handle, entityType, role, label })),
    decision: { decision: item.decision, reason: item.reason, correctedPayload: null }, effective: null,
  }));
  const approvedModel = model({
    workflowState: "PHASE1_APPROVED",
    session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" },
    items: reviewItems,
    approved: { id: "11111111-2222-4333-8444-555555555555", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-22T12:14:56.497Z", content },
  });
  const views = ["overview", "full", "gaps", "calculations", "audit"] as const;
  const render = (view?: (typeof views)[number]) => renderToStaticMarkup(createElement(Phase1Diagnosis, { model: approvedModel, view }));
  const region = (html: string) => html.slice(html.indexOf("<div data-view="), html.lastIndexOf("</main>"));
  const section = (html: string, id: string) => { const start = html.indexOf(`data-group="${id}"`); return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start)); };
  const visiblePart = (article: string) => article.slice(0, article.indexOf('class="disclosure-content"'));
  // What a person reads: markup attributes (such as in-page anchor ids) are not displayed.
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const articles = (html: string) => html.split('<article class="record-card finding-card"').slice(1)
    .map((chunk) => `<article class="record-card finding-card"${chunk.slice(0, chunk.indexOf("</article>"))}`);

  it("defaults to the Overview with a compact approved header and five keyboard-reachable views", () => {
    const html = render();
    expect(html).toContain('<div data-view="overview">');
    expect(html).toContain("Phase 1 Diagnosis — Approved</h1>");
    expect(html).toContain('Approved by Reviewer · <time dateTime="2026-09-22T12:14:56.497Z">22 September 2026, 13:14 BST</time> · Version 1');
    expect(html).toContain("9 diagnosis items · 7 accepted · 2 corrected · 0 rejected");
    const nav = html.slice(html.indexOf('<nav class="tabs diagnosis-tabs" aria-label="Diagnosis views">'), html.indexOf("</nav>", html.indexOf("diagnosis-tabs")));
    for (const [key, label] of [["overview", "Overview"], ["full", "Full Diagnosis"], ["gaps", "Evidence Gaps"], ["calculations", "Calculations"], ["audit", "Audit &amp; Provenance"]]) {
      expect(nav).toContain(`href="?view=${key}"`);
      expect(nav).toContain(`>${label}</a>`);
    }
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav).toMatch(/href="\?view=overview" class="active" aria-current="page"/);
    expect(render("audit")).toMatch(/href="\?view=audit" class="active" aria-current="page"/);
  });

  it("builds the Overview only from the approved artifact: glance counts and grouped statements", () => {
    const overview = region(render());
    expect(overview).toContain("9 reviewed findings");
    for (const count of ["1 current position", "2 strengths", "1 constraint", "1 risk", "1 opportunity", "2 limitations", "1 decision required"]) {
      expect(overview).toContain(`<li>${count}</li>`);
    }
    // Every statement shown is an approved statement, verbatim; limitations are summarised, not listed.
    for (const item of items) {
      if (item.itemType === "limitation") expect(overview).not.toContain(item.statement);
      else expect(overview).toContain(item.statement);
    }
    expect(overview).not.toContain("ORIGINAL AI statement");
  });

  it("places each approved role in its business section", () => {
    const overview = region(render());
    expect(section(overview, "position")).toContain("The business positions itself for established service firms.");
    expect(section(overview, "working")).toContain("A documented client outcome exists.");
    expect(section(overview, "working")).toContain("Recurring revenue is present.");
    const holding = section(overview, "holding-back");
    expect(holding).toContain("Acquisition lacks predictability.");
    expect(holding).toContain("Recurring revenue is concentrated.");
    expect(holding).toContain('<span class="badge">Constraint</span>');
    expect(holding).toContain('<span class="badge">Risk</span>');
    expect(section(overview, "opportunities")).toContain("Enquiry capability may be valuable.");
    expect(section(overview, "decisions")).toContain("A key strategic decision is which channel to build on.");
    expect(overview).toContain("What’s working");
    expect(overview).toContain("What’s holding growth back");
  });

  it("summarises limitations and gaps on the Overview and keeps them fully available elsewhere", () => {
    const overview = region(render());
    expect(section(overview, "limitations-summary")).toContain("2 known limitations affect how confidently some findings can be interpreted.");
    expect(section(overview, "limitations-summary")).toContain('href="?view=full#limitations"');
    const gapsSummary = section(overview, "gaps-summary");
    expect(gapsSummary).toContain("3 gaps remain unresolved.");
    expect(gapsSummary).toContain("2 high · 1 medium");
    expect(gapsSummary).toContain("Missing information is not evidence of poor performance.");
    expect(gapsSummary).not.toContain("Costs untracked.");
    const limitations = section(region(render("full")), "limitations");
    expect(limitations).toContain("Profitability cannot be established.");
    expect(limitations).toContain("Channel economics cannot be quantified.");
  });

  it("shows every approved item exactly once in Full Diagnosis, grouped, in approved order", () => {
    const full = region(render("full"));
    for (const item of items) expect(full.split(`<h3>${item.statement}</h3>`)).toHaveLength(2);
    expect(articles(full)).toHaveLength(items.length);
    const groups = ["position", "strengths", "constraints-risks", "opportunities", "limitations", "decisions"].map((id) => full.indexOf(`data-group="${id}"`));
    expect(groups.every((position) => position >= 0)).toBe(true);
    expect(groups).toEqual([...groups].sort((left, right) => left - right));
    expect(full.indexOf("A documented client outcome exists.")).toBeLessThan(full.indexOf("Recurring revenue is present."));
  });

  it("keeps collapsed cards business-facing: badges and statement only, no rationale, limitations, handles or raw enums", () => {
    for (const html of [region(render()), region(render("full"))]) {
      for (const article of articles(html)) {
        const visible = visiblePart(article);
        expect(visible).toMatch(/<span class="badge">[^<]+<\/span>/);
        expect(visible).toMatch(/<h3>[^<]+<\/h3>/);
        expect(visible).not.toMatch(/rationale text|limitation text/);
        expect(visible).not.toMatch(handle);
        expect(text(visible)).not.toMatch(/evidence_backed|interpretive|hypothesis|ACCEPTED|CORRECTED|I00\d/);
      }
    }
    const full = region(render("full"));
    expect(full).toContain('<span class="badge">High importance</span>');
    expect(full).toContain('<span class="badge">Medium importance</span>');
    expect(full).toContain('<span class="badge decision-accepted">Accepted</span>');
    expect(full).toContain('<span class="badge decision-corrected">Corrected</span>');
  });

  it("reveals reasoning and evidence through an accessible disclosure", () => {
    const article = articles(region(render("full"))).find((chunk) => chunk.includes("Enquiry capability may be valuable."))!;
    const toggle = article.match(/<button type="button" class="disclosure-toggle" aria-expanded="false" aria-controls="([^"]+)">View reasoning &amp; evidence<\/button>/);
    expect(toggle).not.toBeNull();
    const detail = article.slice(article.indexOf(`<div id="${toggle![1]}" class="disclosure-content" hidden="">`));
    expect(detail).toContain("I006 rationale text.");
    expect(detail).toContain("I006 limitation text.");
    expect(detail).toContain("<dt>Grounding</dt><dd>Interpretive");
    expect(detail).toContain("<dt>Interpretation confidence</dt><dd>Medium");
    expect(detail).toContain("2 sources");
    expect(detail).toContain(">View sources</button>");
    expect(detail).toContain("<strong>Primary support</strong> · Claim: Claim one label <code>C001</code>");
  });

  it("shows corrected values as final and keeps the original AI proposal in Audit & Provenance only", () => {
    const corrected = articles(region(render("full"))).find((chunk) => chunk.includes("A key strategic decision is which channel to build on."))!;
    expect(visiblePart(corrected)).toContain('<span class="badge decision-corrected">Corrected</span>');
    expect(corrected).toContain("Corrected — Frame as a decision");
    expect(corrected).toContain('href="?view=audit"');
    for (const view of ["overview", "full", "gaps", "calculations"] as const) expect(region(render(view))).not.toContain("ORIGINAL AI statement");
    const audit = region(render("audit"));
    expect(audit).toContain('data-section="original-ai"');
    expect(audit).toContain("ORIGINAL AI statement for I009.");
    expect(audit).toContain("ORIGINAL AI statement for I001.");
  });

  it("lists every carried-forward gap with only its recorded fields", () => {
    const gapsView = region(render("gaps"));
    expect(gapsView).toContain("3 known evidence gaps remain unresolved.");
    expect(gapsView.match(/data-gap="/g)).toHaveLength(3);
    for (const gap of gaps) {
      expect(gapsView).toContain(gap.missingInformation);
      expect(gapsView).toContain(`<strong>Why this matters:</strong> ${gap.decisionImpact}`);
    }
    expect(gapsView).toContain("<h3>Financial performance</h3>");
    expect(gapsView).not.toMatch(handle);
  });

  it("leads calculations with the business value and keeps technical fields behind a disclosure", () => {
    const calcView = region(render("calculations"));
    expect(calcView.match(/data-calculation="/g)).toHaveLength(2);
    expect(calcView).toContain('<p class="metric-value">£14,400 per year</p>');
    expect(calcView).toContain('<p class="metric-value">£7,200 per year</p>');
    expect(calcView).toContain('<span class="badge">Approximate</span><span class="badge">Derived value</span>');
    expect(calcView).toContain("not realised annual revenue");
    for (const card of calcView.split('<article class="record-card" data-calculation=').slice(1)) {
      expect(visiblePart(card)).not.toMatch(handle);
    }
    expect(calcView).toContain("<code>D001</code>");
    expect(formatCalculationValue({ valueNumeric: null, valuePrecision: "range", valueLower: "1000.0000", valueUpper: "1500.5000", unit: "GBP per month" })).toBe("£1,000–£1,500.5 per month");
  });

  it("keeps the current provenance, approval record and reference map in Audit & Provenance", () => {
    const audit = region(render("audit"));
    for (const value of ["11111111-2222-4333-8444-555555555555", "phase1_diagnosis_artifact_v1", "PHASE1_APPROVED", "run-1", "hash-abc", "content-hash-123",
      "phase1_diagnosis_input_v1", "phase1_diagnosis_v1", "fake / model-x", "snapshot-4 (version 4)", "00000000-0000-4000-8000-000000000900"]) {
      expect(audit).toContain(value);
    }
    for (const group of ["Approval record", "Snapshot provenance", "Diagnosis run", "Review history", "Reference map"]) expect(audit).toContain(`>${group}</button>`);
    for (const code of ["C001", "E002", "G001", "G002", "G003", "D001", "D002"]) expect(audit).toContain(`<code>${code}</code>`);
  });

  it("keeps UUIDs, handles and raw grounding names out of the Overview", () => {
    const overview = region(render());
    expect(overview).not.toMatch(uuid);
    expect(overview).not.toMatch(handle);
    expect(text(overview)).not.toMatch(/evidence_backed|decision_required|limiting_gap|phase1_diagnosis|content-hash|hash-abc|I00\d/);
  });

  it("offers no review, approval or revision controls in the approved state", () => {
    for (const view of views) {
      const html = render(view);
      expect(html).not.toContain("<form");
      expect(html).not.toContain('type="submit"');
      expect(html).not.toMatch(/Approve diagnosis|Request a revised diagnosis|Start review|value="ACCEPTED"/);
      for (const button of html.match(/<button[^>]*>/g) ?? []) expect(button).toContain('type="button" class="disclosure-toggle"');
    }
  });

  it("never changes diagnosis content when switching views", () => {
    const before = structuredClone(approvedModel);
    for (const view of views) render(view);
    expect(approvedModel).toEqual(before);
    const full = region(render("full"));
    for (const item of items) expect(full).toContain(`<h3>${item.statement}</h3>`);
    expect(parseDiagnosisView("full")).toBe("full");
    expect(parseDiagnosisView("unknown")).toBe("overview");
    expect(parseDiagnosisView(undefined)).toBe("overview");
  });

  it("formats approval times for people in UK time without changing the stored value", () => {
    expect(formatApprovalTime("2026-09-22T12:14:56.497Z")).toBe("22 September 2026, 13:14 BST");
    expect(formatApprovalTime("2026-12-01T09:05:00.000Z")).toBe("1 December 2026, 09:05 GMT");
  });
});

describe("Workflow-gated approved state (fail closed on mismatch)", () => {
  const artifact: NonNullable<DiagnosisViewModel["approved"]> = { id: "approved-1", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-22T12:14:56.497Z", content: {
    semantics: "Approval accepts this diagnosis as the current analytical basis for the next strategic phase.",
    decisions: { ACCEPTED: 2, CORRECTED: 0, REJECTED: 0 },
    items: [{ itemRef: "I002", decision: "ACCEPTED", itemType: "position", statement: "Revenue is approximately £240,000.", grounding: "evidence_backed", materiality: "high" }],
    excludedItems: [],
  } };
  const render = (overrides: Partial<DiagnosisViewModel>) => renderToStaticMarkup(createElement(Phase1Diagnosis, { model: model(overrides) }));
  const approvedMarkers = ["Phase 1 Diagnosis — Approved", 'id="approved-summary-heading"', 'aria-label="Diagnosis views"', "<div data-view="];

  it("renders the approved UX only for PHASE1_APPROVED with an approved artifact", () => {
    const html = render({
      workflowState: "PHASE1_APPROVED", approved: artifact,
      session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" },
      items: model().items.map((entry) => decide(entry, "ACCEPTED")),
    });
    for (const marker of approvedMarkers) expect(html).toContain(marker);
    expect(html).not.toContain("data-integrity");
    expect(html).not.toContain("<form");
  });

  it("fails closed for PHASE1_APPROVED without an approved artifact: integrity error only, nothing that looks approved", () => {
    const html = render({ workflowState: "PHASE1_APPROVED", approved: null, session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" } });
    expect(html).toContain('data-integrity="approved-without-artifact"');
    expect(html).toContain("Integrity check failed.");
    expect(html).toContain("no approved diagnosis exists for the current diagnosis run");
    for (const marker of approvedMarkers) expect(html).not.toContain(marker);
    expect(html).not.toContain("<article");
    expect(html).not.toContain("Provenance (recorded by Baslon OS, read-only)");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("never shows approved UX for PHASE1_AWAITING_REVIEW with an approved artifact, and blocks every action", () => {
    // Session left OPEN on purpose, to prove the mismatch alone suppresses decisions, approval and revision.
    const html = render({ workflowState: "PHASE1_AWAITING_REVIEW", approved: artifact });
    expect(html).toContain('data-integrity="artifact-without-approved-workflow"');
    expect(html).toContain("the workflow is PHASE1 AWAITING REVIEW, not PHASE1 APPROVED");
    for (const marker of approvedMarkers) expect(html).not.toContain(marker);
    expect(html).toContain("Phase 1 Diagnosis</h1>");
    expect(html).toContain("Diagnosis items</h2>");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Approve diagnosis");
    expect(html).not.toContain("Request a revised diagnosis");
  });

  it("blocks Run and Add Information for other workflow states when an approved artifact exists", () => {
    const ready = render({ workflowState: "PHASE1_READY", approved: artifact, items: [], session: null });
    expect(ready).toContain('data-integrity="artifact-without-approved-workflow"');
    expect(ready).not.toContain("Run Phase 1 Diagnosis");
    const revision = render({ workflowState: "REVISION_REQUIRED", approved: artifact });
    expect(revision).toContain('data-integrity="artifact-without-approved-workflow"');
    expect(revision).not.toContain('href="/businesses/business/information"');
    for (const html of [ready, revision]) for (const marker of approvedMarkers) expect(html).not.toContain(marker);
  });

  it("leaves the consistent non-approved states unchanged", () => {
    const review = render({});
    expect(review).not.toContain("data-integrity");
    expect(review).toContain('value="ACCEPTED"');
    expect(review).toContain("Every field below is AI-proposed and will be recorded exactly as shown if you accept.");
    expect(render({ workflowState: "PHASE1_READY", run: null, items: [], session: null })).toContain("Run Phase 1 Diagnosis");
    const failed = render({ workflowState: "PHASE1_ANALYSING", run: { ...model().run!, status: "FAILED" }, items: [], session: null });
    expect(failed).toContain("Retry diagnosis");
    expect(failed).not.toContain("data-integrity");
    const revision = render({ workflowState: "REVISION_REQUIRED" });
    expect(revision).toContain('href="/businesses/business/information"');
    expect(revision).not.toContain("data-integrity");
  });
});
