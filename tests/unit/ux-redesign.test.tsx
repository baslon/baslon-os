import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessesDashboard } from "../../app/business-dashboard";
import { BusinessWorkspace } from "../../app/business-workspace";
import { EvidenceStateOverview } from "../../app/evidence-state-overview";
import { EvidenceStateSummary } from "../../app/evidence-state-summary";
import { FactAdmissionAction } from "../../app/fact-admission-action";
import { EvidenceValue } from "../../app/evidence-value";
import { WorkspaceHome } from "../../app/home";
import { ArchivedBusinesses } from "../../app/archived-businesses";
import { confirmArchiveBusiness } from "../../app/business-lifecycle-actions";
import RootLayout from "../../app/layout";
import { deriveBusinessProgress } from "@/domain/business-progress";
import { deriveIntakePresentation } from "@/domain/intake-presentation";
import { buildReviewQueue } from "@/domain/review-queue";
import { buildEvidenceStateSummary } from "@/domain/evidence-state-summary";
import { buildWorkspaceDashboard } from "@/domain/workspace-dashboard";
import { formatWorkspaceMetric, formatWorkspaceMetricPeriod, selectWorkspaceKeyMetrics } from "@/domain/workspace-metrics";
import { countNoun } from "@/domain/presentation";
import { formatEvidenceNumericSummary } from "@/domain/evidence-presentation";

const business = { id: "business-1", name: "Baslon Digital", sector: "Digital agency", primaryGeography: "London, UK", status: "active", archivedAt: null };

describe("Baslon OS UX redesign", () => {
  it("renders businesses as cards without development milestone language", () => {
    const progress = deriveBusinessProgress({ workflowState: "EVIDENCE_READY", reviewSession: { id: "session-1", status: "COMPLETED" } });
    const html = renderToStaticMarkup(createElement(BusinessesDashboard, { businesses: [{ business, progress, primaryHref: "/businesses/business-1", reviewedCount: 39 }] }));
    expect(html).toContain("Businesses");
    expect(html).toContain("Choose a business to continue its analysis");
    expect(html).toContain("Baslon Digital");
    expect(html).toContain("Digital agency · London, UK");
    expect(html).toContain("Evidence review complete");
    expect(html).toContain("39 items reviewed");
    expect(html).not.toContain("Milestone 2");
    expect(html).toContain('href="/businesses/archived"');
  });

  it("renders the organisation Workspace Dashboard with live summary and urgent work", () => {
    const active = {
      business, workflow: { state: "EVIDENCE_PROCESSING" },
      latestExtraction: { status: "SUCCEEDED" as const }, reviewSession: { status: "OPEN" as const },
      currentReviewedCount: 12, currentProposalCount: 39, lastActivityAt: new Date("2026-09-14"),
      primaryHref: "/businesses/business-1/reviews/run", progress: { statusLabel: "Evidence review in progress" },
    };
    const model = buildWorkspaceDashboard([active]);
    const html = renderToStaticMarkup(createElement(WorkspaceHome, { model }));
    expect(html).toContain("Workspace");
    expect(html).toContain("1</strong><span>Business");
    expect(html).toContain("Evidence reviews requiring attention");
    expect(html).toContain("Evidence review in progress");
    expect(html).toContain("12 of 39 proposals reviewed");
    expect(html).toContain("Continue review");
    expect(html).not.toContain("Continue where you left off");
    expect(model.recent).toEqual([]);
    expect(html).not.toContain("Recently active businesses");
  });

  it("renders the application shell with only Home and Businesses navigation", () => {
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "Content")));
    expect(html).toContain("Baslon OS");
    expect(html).toContain('href="/">Home');
    expect(html).toContain('href="/businesses">Businesses');
    expect(html).not.toContain("Settings");
  });

  it("renders the Workspace empty state without empty operational sections", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceHome, { model: { summary: { total: 0, awaitingReview: 0, failedAnalyses: 0, completedReviews: 0 }, attention: [], recent: [] } }));
    expect(html).toContain("No businesses yet");
    expect(html).toContain("Create your first business");
    expect(html).not.toContain("Workspace overview");
    expect(html).not.toContain("Work requiring attention");
  });

  it("prioritises failed analysis and excludes completed review from urgent work", () => {
    const base = { currentReviewedCount: 0, currentProposalCount: 3, progress: { statusLabel: "Status" } };
    const completed = { ...base, business: { id: "completed", name: "Completed" }, workflow: { state: "EVIDENCE_READY" }, latestExtraction: { status: "SUCCEEDED" as const }, reviewSession: { status: "COMPLETED" as const }, lastActivityAt: new Date("2026-09-14"), primaryHref: "/businesses/completed" };
    const review = { ...base, business: { id: "review", name: "Review" }, workflow: { state: "EVIDENCE_PROCESSING" }, latestExtraction: { status: "SUCCEEDED" as const }, reviewSession: { status: "OPEN" as const }, lastActivityAt: new Date("2026-09-15"), primaryHref: "/businesses/review/reviews/run" };
    const failed = { ...base, business: { id: "failed", name: "Failed" }, workflow: { state: "EVIDENCE_PROCESSING" }, latestExtraction: { status: "FAILED" as const }, lastActivityAt: new Date("2026-09-13"), primaryHref: "/businesses/failed/intake" };
    const model = buildWorkspaceDashboard([completed, review, failed]);
    expect(model.attention.map((item) => item.business.business.id)).toEqual(["failed", "review"]);
    expect(model.summary.failedAnalyses).toBe(1);
    expect(model.summary.completedReviews).toBe(1);
    expect(model.attention[0].actionLabel).toBe("Retry analysis →");
    expect(model.recent.map((item) => item.business.id)).toEqual(["completed"]);
  });

  it("limits Recent businesses to five in deterministic activity order", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      business: { id: `business-${index}`, name: `Business ${index}` }, workflow: { state: "EVIDENCE_READY" },
      latestExtraction: { status: "SUCCEEDED" as const }, reviewSession: { status: "COMPLETED" as const },
      currentReviewedCount: 1, currentProposalCount: 1, lastActivityAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}`),
      primaryHref: `/businesses/business-${index}`, progress: { statusLabel: "Evidence review complete" },
    }));
    expect(buildWorkspaceDashboard(items).recent.map((item) => item.business.id)).toEqual(["business-6", "business-5", "business-4", "business-3", "business-2"]);
  });

  it("shows the no-attention state when all business reviews are complete", () => {
    const model = buildWorkspaceDashboard([{ business: { id: "done", name: "Done" }, workflow: { state: "EVIDENCE_READY" }, latestExtraction: { status: "SUCCEEDED" as const }, reviewSession: { status: "COMPLETED" as const }, currentReviewedCount: 2, currentProposalCount: 2, lastActivityAt: new Date("2026-09-14"), primaryHref: "/businesses/done", progress: { statusLabel: "Evidence review complete" } }]);
    const html = renderToStaticMarkup(createElement(WorkspaceHome, { model }));
    expect(html).toContain("Nothing currently needs review");
    expect(html).toContain("Recently active businesses");
  });

  it("maps workflow state to contextual primary actions", () => {
    expect(deriveBusinessProgress({ workflowState: "NEW" }).primaryActionLabel).toBe("Add business information →");
    expect(deriveBusinessProgress({ workflowState: "EVIDENCE_PROCESSING", latestExtraction: { id: "run", status: "SUCCEEDED" } }).primaryActionLabel).toBe("Review findings →");
    expect(deriveBusinessProgress({ workflowState: "EVIDENCE_PROCESSING", latestExtraction: { id: "run", status: "SUCCEEDED" }, reviewSession: { id: "review", status: "OPEN" } }).primaryActionLabel).toBe("Continue Evidence Review →");
  });

  it("renders business metadata, human stages and canonical counts in the workspace", () => {
    const progress = deriveBusinessProgress({ workflowState: "EVIDENCE_READY", latestExtraction: { id: "run", status: "SUCCEEDED" }, reviewSession: { id: "review", status: "COMPLETED" } });
    const html = renderToStaticMarkup(createElement(BusinessWorkspace, { model: {
      business, progress, primaryHref: "/businesses/business-1",
      canAddInformation: false,
      counts: [{ singular: "Observation", plural: "Observations", value: 7 }, { singular: "Metric", plural: "Metrics", value: 5 }],
      metrics: [{ id: "metric-1", metricKey: "annual_revenue", metricLabel: "Annual revenue", numericValue: "80000", unit: "GBP", periodStart: null, periodEnd: null }],
    } }));
    expect(html).toContain("Digital agency · London, UK");
    expect(html).toContain("Evidence extraction");
    expect(html).toContain("7</strong><span>Observations");
    expect(html).toContain("£80,000");
    expect(html).toContain('href="/businesses"');
    expect(html).toContain("Archive business");
    expect(html).toContain("Business management");
  });

  it("selects performance metrics without removing preference metrics from the underlying state", () => {
    const metrics = [
      { id: "preference", metricKey: "founder_hours_target", metricLabel: "Desired working week", numericValue: "30", unit: "hours per week", periodStart: null, periodEnd: null },
      { id: "revenue", metricKey: "annual_revenue", metricLabel: "Annual revenue", numericValue: "80000", unit: "GBP", periodStart: null, periodEnd: null },
      { id: "leads", metricKey: "enquiries", metricLabel: "Enquiries", numericValue: "428", unit: "enquiries", periodStart: null, periodEnd: null },
    ];
    const selected = selectWorkspaceKeyMetrics(metrics);
    expect(selected.map((metric) => metric.id)).toEqual(["revenue", "leads"]);
    expect(selected).toHaveLength(2);
    expect(metrics).toHaveLength(3);
    expect(metrics.find((metric) => metric.id === "preference")?.numericValue).toBe("30");
  });

  it("formats currency and ordinary units without changing stored values", () => {
    const annual = { numericValue: "80000.00", unit: "GBP" };
    const monthly = { numericValue: "1200", unit: "GBP per month" };
    expect(formatWorkspaceMetric(annual)).toBe("£80,000");
    expect(formatWorkspaceMetric(monthly)).toBe("£1,200 / month");
    expect(formatWorkspaceMetric({ numericValue: "428", unit: "enquiries" })).toBe("428 enquiries");
    expect(annual).toEqual({ numericValue: "80000.00", unit: "GBP" });
  });

  it("formats Workspace metric date ranges without changing canonical dates", () => {
    const periodStart = "2024-10-31";
    const periodEnd = "2026-08-30";
    expect(formatWorkspaceMetricPeriod(periodStart, periodEnd)).toBe("31 Oct 2024 – 30 Aug 2026");
    expect(formatWorkspaceMetricPeriod(periodStart, null)).toBe("From 31 Oct 2024");
    expect(periodStart).toBe("2024-10-31");
    expect(periodEnd).toBe("2026-08-30");
  });

  it("keeps only one prominent Evidence State action in a completed Workspace", () => {
    const progress = { ...deriveBusinessProgress({ workflowState: "EVIDENCE_READY" }), primaryActionLabel: "View Evidence State →" };
    const html = renderToStaticMarkup(createElement(BusinessWorkspace, { model: {
      business, progress, primaryHref: "/businesses/business-1/evidence", canAddInformation: false,
      counts: [], metrics: [],
    } }));
    expect(html.match(/class="button-link[^\"]*" href="\/businesses\/business-1\/evidence"/g)).toHaveLength(1);
    expect(html).toContain("View all");
  });

  it("renders an archived Workspace as read-only with Restore and no strategic actions", () => {
    const progress = deriveBusinessProgress({ workflowState: "EVIDENCE_PROCESSING", latestExtraction: { id: "run", status: "SUCCEEDED" }, reviewSession: { id: "review", status: "OPEN" } });
    const html = renderToStaticMarkup(createElement(BusinessWorkspace, { model: {
      business: { ...business, status: "archived", archivedAt: new Date("2026-09-14") },
      progress, primaryHref: "/businesses/business-1/reviews/run", activeReviewHref: "/businesses/business-1/reviews/run",
      canAddInformation: true, counts: [], metrics: [],
    } }));
    expect(html).toContain("Archived business");
    expect(html).toContain("read-only");
    expect(html).toContain("Restore business");
    expect(html).not.toContain("Add more information");
    expect(html).not.toContain("Continue Evidence Review");
    expect(html).not.toContain("Archive business");
  });

  it("renders archived Businesses and their empty state without exposing IDs as text", () => {
    const html = renderToStaticMarkup(createElement(ArchivedBusinesses, { businesses: [{
      business: { id: "private-business-id", name: "Archived Example", archivedAt: new Date("2026-09-14") },
    }] }));
    expect(html).toContain("Archived businesses");
    expect(html).toContain("Archived 14 Sept 2026");
    expect(html).toContain("View business");
    expect(html).toContain("Restore business");
    expect(html).not.toContain(">private-business-id<");
    expect(renderToStaticMarkup(createElement(ArchivedBusinesses, { businesses: [] }))).toContain("No archived businesses.");
  });

  it("requires confirmation before archiving", () => {
    const messages: string[] = [];
    expect(confirmArchiveBusiness("Example Business", (message) => {
      messages.push(message);
      return false;
    })).toBe(false);
    expect(messages[0]).toContain("Archive Example Business?");
    expect(messages[0]).toContain("preserved");
  });

  it("automatically restores the latest failed intake without exposing provider detail", () => {
    const view = deriveIntakePresentation({
      latestRun: { status: "FAILED", rawIntakeText: "Preserved founder notes", sourceReference: "Founder interview" },
      hasCanonicalEvidence: false,
      hasErrorSignal: true,
    });
    expect(view.rawIntakeText).toBe("Preserved founder notes");
    expect(view.sourceReference).toBe("Founder interview");
    expect(view.showRetryMessage).toBe(true);
    expect(JSON.stringify(view)).not.toContain("OpenAI");
  });

  it("uses returning-business intake copy when canonical information exists", () => {
    expect(deriveIntakePresentation({ hasCanonicalEvidence: true, hasErrorSignal: false }).heading).toBe("Add more information");
  });

  it("advances one proposal at a time and reaches completion after the final decision", () => {
    const proposals = [{ id: "one", proposalType: "claim" }, { id: "two", proposalType: "evidence" }];
    expect(buildReviewQueue(proposals, []).current?.id).toBe("one");
    expect(buildReviewQueue(proposals, [{ proposalId: "one", decision: "ACCEPTED" }]).current?.id).toBe("two");
    const complete = buildReviewQueue(proposals, [{ proposalId: "one", decision: "ACCEPTED" }, { proposalId: "two", decision: "REJECTED" }]);
    expect(complete.current).toBeUndefined();
    expect(complete.percent).toBe(100);
  });

  it("builds Evidence State counts without changing canonical values", () => {
    const summary = buildEvidenceStateSummary({ facts: 0, observations: 7, managementBeliefs: 3, hypotheses: 2, aiInferences: 0, unknowns: 4, evidence: 8, metrics: 5, relationships: 10 });
    expect(summary.primary).toEqual([
      { singular: "Claim", plural: "Claims", value: 16 },
      { singular: "Evidence", plural: "Evidence", value: 8 },
      { singular: "Metric", plural: "Metrics", value: 5 },
      { singular: "Relationship", plural: "Relationships", value: 10 },
    ]);
    expect(summary.claimTypes.find((item) => item.plural === "Observations")?.value).toBe(7);
    expect(summary.claimTypes.find((item) => item.plural === "Facts")?.value).toBe(0);
    const html = renderToStaticMarkup(createElement(EvidenceStateSummary, { summary }));
    expect(html.match(/class="summary-card"/g)).toHaveLength(4);
    expect(html).toContain("Claim types");
    expect(html).toContain("Management beliefs");
  });

  it("pluralises Claim-type counts correctly", () => {
    expect(countNoun(1, "Unknown", "Unknowns")).toBe("Unknown");
    expect(countNoun(2, "Unknown", "Unknowns")).toBe("Unknowns");
    expect(countNoun(1, "Fact", "Facts")).toBe("Fact");
    expect(countNoun(2, "Fact", "Facts")).toBe("Facts");
    expect(countNoun(1, "Hypothesis", "Hypotheses")).toBe("Hypothesis");
    expect(countNoun(2, "Hypothesis", "Hypotheses")).toBe("Hypotheses");
    const summary = buildEvidenceStateSummary({ facts: 1, observations: 0, managementBeliefs: 0, hypotheses: 2, aiInferences: 1, unknowns: 1, evidence: 0, metrics: 0, relationships: 0 });
    const html = renderToStaticMarkup(createElement(EvidenceStateSummary, { summary }));
    expect(html).toContain("1</strong> Fact");
    expect(html).toContain("2</strong> Hypotheses");
    expect(html).toContain("1</strong> AI inference");
    expect(html).toContain("1</strong> Unknown");
  });

  it("uses plain-language Evidence State actions and relationship empty state", () => {
    const html = renderToStaticMarkup(createElement(EvidenceStateOverview, {
      claims: 13, activeClaimTypes: 4, evidence: 7, metrics: 4, relationships: 0,
    }));
    expect(html).toContain("13 reviewed claims across 4 claim types");
    expect(html).not.toContain("epistemic");
    expect(html).not.toContain("Browse");
    expect(html).toContain("View Claims");
    expect(html).toContain("View Evidence");
    expect(html).toContain("View Metrics");
    expect(html).toContain("View Relationships");
    expect(html).toContain("No reviewed relationships yet.");
    expect(html).toContain('href="?view=relationships"');
  });

  it("keeps Fact Admission available inside a secondary disclosure", () => {
    const html = renderToStaticMarkup(createElement(FactAdmissionAction, null,
      createElement("button", { type: "submit" }, "Confirm fact admission"),
    ));
    expect(html).toContain('<details class="fact-admission-action">');
    expect(html).toContain("More actions");
    expect(html).toContain("Admit as fact with human confirmation");
    expect(html).toContain("Confirm fact admission");
    expect(html).not.toContain("open=\"");
  });

  it("omits misleading numeric summaries for composite Evidence units while retaining the statement", () => {
    const statement = "Recurring revenue is approximately £1,200 per month and ad-hoc revenue is approximately 10%.";
    const html = renderToStaticMarkup(createElement(EvidenceValue, {
      statement,
      valueNumeric: "1200",
      valueText: "£1,200 per month and 10%",
      unit: "GBP per month; percent",
    }));
    expect(html).toContain(statement);
    expect(html).not.toContain("1,200%");
    expect(html).not.toContain("metric-value");
  });

  it("formats only unambiguous Evidence numeric units", () => {
    expect(formatEvidenceNumericSummary("80000.00", "GBP")).toBe("£80,000");
    expect(formatEvidenceNumericSummary("10", "percent")).toBe("10%");
    expect(formatEvidenceNumericSummary("428", "enquiries")).toBe("428 enquiries");
    expect(formatEvidenceNumericSummary("30", "hours per week")).toBe("30 hours per week");
    expect(formatEvidenceNumericSummary("1200", "GBP per month; percent")).toBeNull();
  });
});
