import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialIntakeAvailability, type InitialIntakeRun } from "@/domain/initial-intake";
import { initialIntakeUnavailableTarget } from "@/domain/intake-retry";
import { acceptsAddInformation } from "@/domain/workflow";
import { deriveBusinessProgress } from "@/domain/business-progress";
import { EvidenceQuality } from "../../app/evidence-quality";
import { BusinessWorkspace } from "../../app/business-workspace";

const now = new Date("2026-09-18T12:00:00Z");
function run(overrides: Partial<InitialIntakeRun>): InitialIntakeRun {
  return {
    id: "run",
    status: "SUCCEEDED",
    sourceSubmissionId: null,
    createdAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

describe("initial intake availability", () => {
  it("is available before intake and after a failed or missing initial run", () => {
    for (const workflowState of ["NEW", "INTAKE_IN_PROGRESS", "INTAKE_READY"] as const) {
      expect(initialIntakeAvailability({ workflowState, now })).toEqual({ kind: "available" });
    }
    expect(initialIntakeAvailability({ workflowState: "EVIDENCE_PROCESSING", now }))
      .toEqual({ kind: "available" });
    expect(initialIntakeAvailability({
      workflowState: "EVIDENCE_PROCESSING", latestRun: run({ status: "FAILED" }), now,
    })).toEqual({ kind: "available" });
  });

  it("protects a successful run awaiting review and a fresh running analysis", () => {
    expect(initialIntakeAvailability({
      workflowState: "EVIDENCE_PROCESSING", latestRun: run({ status: "SUCCEEDED" }), now,
    })).toEqual({ kind: "review_in_progress", runId: "run" });
    expect(initialIntakeAvailability({
      workflowState: "EVIDENCE_PROCESSING", latestRun: run({ status: "RUNNING" }), now,
    })).toEqual({ kind: "analysis_running", runId: "run" });
  });

  it("offers recovery for an abandoned running analysis", () => {
    expect(initialIntakeAvailability({
      workflowState: "EVIDENCE_PROCESSING",
      latestRun: run({ status: "RUNNING", createdAt: new Date(now.getTime() - 16 * 60_000) }),
      now,
    })).toEqual({ kind: "available", staleRunId: "run" });
  });

  it("routes reviewed Businesses and Add Information cycles to Add Information", () => {
    for (const workflowState of ["EVIDENCE_READY", "GAP_RESOLUTION_REQUIRED"] as const) {
      expect(initialIntakeAvailability({ workflowState, now })).toEqual({ kind: "use_add_information" });
    }
    expect(initialIntakeAvailability({
      workflowState: "EVIDENCE_PROCESSING",
      latestRun: run({ status: "FAILED", sourceSubmissionId: "source" }),
      now,
    })).toEqual({ kind: "use_add_information" });
    expect(initialIntakeAvailability({ workflowState: "GAP_ANALYSIS", now }))
      .toEqual({ kind: "unavailable" });
  });

  it("redirects unavailable intake to the relevant next step", () => {
    expect(initialIntakeUnavailableTarget("b", { kind: "review_in_progress", runId: "r" }))
      .toBe("/businesses/b/reviews/r");
    expect(initialIntakeUnavailableTarget("b", { kind: "use_add_information" }))
      .toBe("/businesses/b/information");
    expect(initialIntakeUnavailableTarget("b", { kind: "analysis_running", runId: "r" }))
      .toBe("/businesses/b/intake");
    expect(initialIntakeUnavailableTarget("b", { kind: "unavailable" })).toBe("/businesses/b");
  });
});

describe("Add Information navigation", () => {
  it("accepts ordinary Add Information only once evidence has been reviewed", () => {
    expect(acceptsAddInformation("EVIDENCE_READY")).toBe(true);
    expect(acceptsAddInformation("GAP_RESOLUTION_REQUIRED")).toBe(true);
    for (const state of ["NEW", "EVIDENCE_PROCESSING", "GAP_ANALYSIS", undefined]) {
      expect(acceptsAddInformation(state)).toBe(false);
    }
  });

  it("offers Add other information on Evidence Quality while gaps await resolution", () => {
    const business = { id: "business", name: "Example", status: "active" };
    const model = {
      business,
      workflow: { state: "GAP_RESOLUTION_REQUIRED" },
      latestSnapshot: { id: "snapshot", version: 2 },
      analysis: { run: { id: "run", status: "SUCCEEDED" as const, inputSnapshotId: "snapshot" }, contradictions: [], gaps: [] },
      isHistorical: false,
      surfacedQuestions: [],
    };
    const html = renderToStaticMarkup(createElement(EvidenceQuality, { model }));
    expect(html).toContain("No high-priority questions were generated.");
    expect(html).toContain('href="/businesses/business/information"');
    expect(html).toContain("Add other information");

    const archived = renderToStaticMarkup(createElement(EvidenceQuality, {
      model: { ...model, business: { ...business, status: "archived" } },
    }));
    expect(archived).not.toContain("Add other information");
    const analysing = renderToStaticMarkup(createElement(EvidenceQuality, {
      model: { ...model, workflow: { state: "GAP_ANALYSIS" } },
    }));
    expect(analysing).not.toContain("Add other information");
  });

  it("shows the workspace Add Information link when the workspace allows it", () => {
    const html = renderToStaticMarkup(createElement(BusinessWorkspace, { model: {
      business: { id: "business", name: "Example", sector: null, primaryGeography: null, status: "active", archivedAt: null },
      progress: deriveBusinessProgress({ workflowState: "GAP_RESOLUTION_REQUIRED" }),
      primaryHref: "/businesses/business",
      canAddInformation: acceptsAddInformation("GAP_RESOLUTION_REQUIRED"),
      counts: [], metrics: [],
    } }));
    expect(html).toContain('href="/businesses/business/information"');
  });
});
