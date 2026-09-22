import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diagnosisReviewFieldsV2 } from "@/domain/phase1-diagnosis-review-card";
import type { DiagnosisHeadlineViewModel } from "@/services/diagnosis-headline-service";
import type { DiagnosisViewModel } from "@/services/phase1-diagnosis-service";
import { DiagnosisHeadlines } from "../../app/diagnosis-headlines";
import { Phase1Diagnosis } from "../../app/phase1-diagnosis";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll("\"", "&quot;");

const reference = { handle: "E001", entityType: "evidence", role: "primary", label: "Revenue evidence" };

function diagnosisModel(overrides: Partial<DiagnosisViewModel> = {}): DiagnosisViewModel {
  return {
    business: { id: "b-1", name: "Synthetic Co (synthetic test)", status: "active" },
    workflowState: "PHASE1_AWAITING_REVIEW",
    snapshot: { id: "s-4", version: 4 },
    run: {
      id: "run-1", status: "SUCCEEDED", inputProjectionVersion: "phase1_diagnosis_input_v1", promptVersion: "phase1_diagnosis_v2",
      inputHash: "hash-abc", provider: "fake", modelIdentifier: "model-x", snapshotContentHash: "content-hash",
      createdAt: "2026-09-21T10:00:00.000Z", completedAt: "2026-09-21T10:00:20.000Z",
    },
    gaps: [],
    calculations: [],
    items: [{
      id: "item-1", itemRef: "I001", headline: "Recurring revenue is a small share of revenue",
      itemType: "constraint", statement: "Recurring revenue is approximately £1,200 per month.",
      rationale: "Stated in evidence.", grounding: "evidence_backed", materiality: "high",
      interpretationConfidence: null, limitations: null, references: [reference],
      decision: null, effective: null,
    }],
    session: { id: "session-1", reviewerId: "Reviewer", status: "OPEN" },
    approved: null,
    headlines: { source: "none", byItemRef: {} },
    ...overrides,
  };
}

const approvedItem = {
  itemRef: "I001", diagnosisItemId: "item-1", decision: "ACCEPTED", reason: null, itemType: "constraint",
  statement: "Recurring revenue is approximately £1,200 per month.", rationale: "Stated in evidence.",
  grounding: "evidence_backed", materiality: "high", interpretationConfidence: null, limitations: null,
  references: [{ ...reference, id: "e-1" }],
};

function approvedModel(overrides: Partial<DiagnosisViewModel> = {}): DiagnosisViewModel {
  return diagnosisModel({
    workflowState: "PHASE1_APPROVED",
    session: { id: "session-1", reviewerId: "Reviewer", status: "COMPLETED" },
    run: { ...diagnosisModel().run!, promptVersion: "phase1_diagnosis_v1" },
    items: [{ ...diagnosisModel().items[0], headline: null, decision: { decision: "ACCEPTED", reason: null, correctedPayload: null }, effective: null }],
    approved: {
      id: "approved-1", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-22T12:14:56.497Z",
      artifactVersion: "phase1_diagnosis_artifact_v1",
      content: {
        artifactVersion: "phase1_diagnosis_artifact_v1", semantics: "Approval accepts this diagnosis as the current analytical basis.",
        decisions: { ACCEPTED: 1, CORRECTED: 0, REJECTED: 0 }, items: [approvedItem], excludedItems: [],
        calculations: [], carriedForwardGaps: [],
      },
    },
    ...overrides,
  });
}

describe("Phase 1 Diagnosis review surface under v2", () => {
  it("shows the proposed headline as a material field and lets the reviewer correct it", () => {
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: diagnosisModel() }));
    // Every v2 material field is labelled and shown before any decision (M4-11).
    for (const { label } of diagnosisReviewFieldsV2) expect(html).toContain(label);
    expect(html).toContain(escape("Recurring revenue is a small share of revenue"));
    expect(html).toContain('data-field="headline"');
    expect(html).toContain('name="headline"');
    expect(html).toContain('maxLength="120"');
  });

  it("keeps a v1 review exactly as it was: eight fields and no headline input", () => {
    const v1Model = diagnosisModel({
      run: { ...diagnosisModel().run!, promptVersion: "phase1_diagnosis_v1" },
      items: [{ ...diagnosisModel().items[0], headline: null }],
    });
    const html = renderToStaticMarkup(createElement(Phase1Diagnosis, { model: v1Model }));
    expect(html).not.toContain('name="headline"');
    expect(html).not.toContain('data-field="headline"');
    expect(html).toContain("Conclusion");
  });
});

describe("Approved diagnosis rendering with and without headlines", () => {
  const render = (model: DiagnosisViewModel, view: "overview" | "full" | "audit" = "overview") =>
    renderToStaticMarkup(createElement(Phase1Diagnosis, { model, view }));

  it("falls back to the approved statement when no headline exists, and fabricates nothing", () => {
    const html = render(approvedModel());
    expect(text(html)).toContain("Recurring revenue is approximately £1,200 per month.");
    expect(html).not.toContain("finding-headline");
    // The five-view information architecture is unchanged.
    for (const label of ["Overview", "Full Diagnosis", "Evidence Gaps", "Calculations", "Audit &amp; Provenance"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Constraint");
    expect(html).toContain("Accepted");
  });

  it("leads with a companion headline, keeps the statement beneath it, and records the set in Audit", () => {
    const model = approvedModel({
      headlines: {
        source: "companion", setId: "set-1", setVersion: 1, approvedBy: "Reviewer",
        approvedAt: "2026-09-23T10:00:00.000Z", byItemRef: { I001: "Recurring revenue is a small share of revenue" },
      },
    });
    const overview = render(model);
    expect(overview).toContain('class="finding-headline"');
    const reading = text(overview);
    expect(reading.indexOf("Recurring revenue is a small share of revenue"))
      .toBeLessThan(reading.indexOf("Recurring revenue is approximately £1,200 per month."));
    // On the Overview the section conveys the type, so only importance is repeated.
    const group = overview.slice(overview.indexOf('data-group="holding-back"'), overview.indexOf("</section>", overview.indexOf('data-group="holding-back"')));
    // What a person reads before opening the detail: badges, headline and statement.
    const visible = group.slice(0, group.indexOf('class="disclosure-content"'));
    expect(visible).toContain("High importance");
    expect(text(visible)).not.toContain("Constraint");
    expect(text(visible)).not.toContain("Accepted");
    // Full Diagnosis keeps type and review status, and Audit records the set.
    const full = render(model, "full");
    expect(text(full)).toContain("Constraint");
    expect(text(full)).toContain("Accepted");
    const audit = render(model, "audit");
    expect(audit).toContain("Headline set");
    expect(audit).toContain("set-1");
  });

  it("uses a native v2 headline from the approved artifact itself", () => {
    const model = approvedModel({
      approved: {
        ...approvedModel().approved!,
        artifactVersion: "phase1_diagnosis_artifact_v2",
        content: {
          ...approvedModel().approved!.content,
          artifactVersion: "phase1_diagnosis_artifact_v2",
          items: [{ ...approvedItem, headline: "Recurring revenue is a small share of revenue" }],
        },
      },
      headlines: { source: "native", byItemRef: { I001: "Recurring revenue is a small share of revenue" } },
    });
    expect(render(model)).toContain(escape("Recurring revenue is a small share of revenue"));
  });
});

function headlineModel(overrides: Partial<DiagnosisHeadlineViewModel> = {}): DiagnosisHeadlineViewModel {
  return {
    business: { id: "b-1", name: "Synthetic Co (synthetic test)", status: "active" },
    workflowState: "PHASE1_APPROVED",
    approved: {
      id: "approved-1", version: 1, artifactVersion: "phase1_diagnosis_artifact_v1",
      approvedBy: "Reviewer", approvedAt: "2026-09-22T12:14:56.497Z",
    },
    native: false,
    items: [
      {
        itemRef: "I001", diagnosisItemId: "item-1", itemType: "constraint",
        statement: "Recurring revenue is approximately £1,200 per month.",
        proposed: "Recurring revenue is a small share of revenue", decision: null, finalHeadline: null,
      },
      {
        itemRef: "I002", diagnosisItemId: "item-2", itemType: "limitation",
        statement: "Profitability cannot be established from the current snapshot.",
        proposed: "Profitability cannot yet be established", decision: null, finalHeadline: null,
      },
    ],
    run: {
      id: "run-h1", status: "SUCCEEDED", promptVersion: "diagnosis_headlines_v1",
      inputProjectionVersion: "diagnosis_headlines_input_v1", inputHash: "hash", provider: "fake",
      modelIdentifier: "model-x", createdAt: "2026-09-23T09:00:00.000Z", completedAt: "2026-09-23T09:00:10.000Z",
    },
    failedRuns: [],
    session: { id: "hsession-1", reviewerId: "Reviewer", status: "OPEN", setVersion: 1 },
    approvedSet: null,
    setHistory: [],
    ...overrides,
  };
}

describe("Companion headline review surface", () => {
  const render = (model: DiagnosisHeadlineViewModel) => renderToStaticMarkup(createElement(DiagnosisHeadlines, { model }));

  it("shows each approved statement beside its proposed headline, with Accept and Correct only", () => {
    const html = render(headlineModel());
    const reading = text(html);
    expect(reading).toContain("Recurring revenue is approximately £1,200 per month.");
    expect(reading).toContain("Recurring revenue is a small share of revenue");
    expect(html).toContain(">Accept</button>");
    expect(html).toContain("Correct this headline");
    // There is no headline reject: a poor headline is corrected.
    expect(html).not.toContain(">Reject</button>");
    expect(html).not.toContain("REJECTED");
    // The already-approved material fields are not re-reviewed here.
    expect(reading).not.toContain("Grounding");
    expect(reading).not.toContain("Supporting references");
  });

  it("offers approval only once every headline is decided, and never a workflow action", () => {
    const undecided = render(headlineModel());
    expect(undecided).toContain("Decide every headline");
    expect(undecided).not.toContain("Approve headline set</button>");
    const decided = render(headlineModel({
      items: headlineModel().items.map((item, index) => ({
        ...item,
        decision: index === 0
          ? { decision: "ACCEPTED", correctedHeadline: null, reason: null }
          : { decision: "CORRECTED", correctedHeadline: "Profitability is still unproven", reason: "Clearer" },
        finalHeadline: index === 0 ? item.proposed : "Profitability is still unproven",
      })),
    }));
    expect(decided).toContain("Approve headline set</button>");
    expect(text(decided)).toContain("Profitability is still unproven");
    expect(text(decided)).not.toContain("Approve diagnosis");
  });

  it("shows an approved set read-only, with no decision controls left", () => {
    const html = render(headlineModel({
      session: null,
      items: headlineModel().items.map((item) => ({
        ...item,
        decision: { decision: "ACCEPTED", correctedHeadline: null, reason: null },
        finalHeadline: item.proposed,
      })),
      approvedSet: {
        id: "set-1", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-23T10:00:00.000Z",
        proposalRunId: "run-h1", reviewSessionId: "hsession-1",
        headlines: [
          { itemRef: "I001", headline: "Recurring revenue is a small share of revenue" },
          { itemRef: "I002", headline: "Profitability cannot yet be established" },
        ],
      },
      setHistory: [{ id: "set-1", version: 1, approvedBy: "Reviewer", approvedAt: "2026-09-23T10:00:00.000Z" }],
    }));
    expect(html).toContain("Approved headline set, version 1");
    expect(html).not.toContain(">Accept</button>");
    expect(html).not.toContain("Approve headline set</button>");
    // A change is a new version: a further review can be started over the same proposals.
    expect(html).toContain("Review headlines again (version 2)");
  });

  it("refuses a native v2 diagnosis and a failed proposal run without silently retrying", () => {
    expect(render(headlineModel({ native: true, items: [] }))).toContain("already has reviewed headlines");
    const failedOnce = render(headlineModel({
      run: null, session: null, items: headlineModel().items.map((item) => ({ ...item, proposed: null })),
      failedRuns: [{ id: "run-h0", completedAt: "2026-09-23T08:00:00.000Z" }],
    }));
    expect(failedOnce).toContain("The last proposal run failed.");
    expect(failedOnce).toContain("Retry headline proposals (one retry)");
    const failedTwice = render(headlineModel({
      run: null, session: null, items: headlineModel().items.map((item) => ({ ...item, proposed: null })),
      failedRuns: [
        { id: "run-h0", completedAt: "2026-09-23T08:00:00.000Z" },
        { id: "run-h-1", completedAt: "2026-09-23T07:00:00.000Z" },
      ],
    }));
    expect(failedTwice).toContain("No further automatic retry is available");
    expect(failedTwice).not.toContain("Retry headline proposals");
  });
});
