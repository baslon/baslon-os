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
import { Phase1Diagnosis } from "../../app/phase1-diagnosis";

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
    expect(approved).toContain("Approved diagnosis · version 1");
    expect(approved).toContain("Rejected and excluded: I001");
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
