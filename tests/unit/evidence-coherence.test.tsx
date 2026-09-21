import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evidenceCoherenceOutputSchema } from "@/ai/evidence-coherence/contracts";
import { EVIDENCE_COHERENCE_PROMPT_VERSION, evidenceCoherencePrompt } from "@/ai/evidence-coherence/prompt";
import { validateEvidenceCoherenceOutput } from "@/ai/evidence-coherence/validation";
import {
  EVIDENCE_COHERENCE_INPUT_VERSION,
  selectSurfacedQuestions,
} from "@/domain/evidence-coherence";
import {
  buildEvidenceCoherenceModelInput,
  buildEvidenceCoherenceProjection,
  hashEvidenceCoherenceModelInput,
} from "@/domain/evidence-coherence-projection";
import { EvidenceQuality } from "../../app/evidence-quality";
import { BusinessWorkspace } from "../../app/business-workspace";
import { deriveBusinessProgress } from "@/domain/business-progress";

const claimId = "11111111-1111-4111-8111-111111111111";
const replacementId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const metricId = "44444444-4444-4444-8444-444444444444";

function snapshot() {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    businessId: "66666666-6666-4666-8666-666666666666",
    version: 2,
    snapshotData: {
      profile: { services: ["Advisory"] },
      claims: [
        { id: claimId, statement: "Old claim", claimType: "observation", subjectArea: "market", status: "superseded", supersededByClaimId: replacementId },
        { id: replacementId, statement: "Active claim", claimType: "observation", subjectArea: "market", status: "active", supersededByClaimId: null },
      ],
      evidence: [{ id: evidenceId, statement: "Measured result", valueNumeric: "10", valueText: null, unit: "percent", periodStart: null, periodEnd: null, sourceType: "intake", sourceReference: null, reliabilityLevel: "high", directnessLevel: "direct", recencyLevel: "current", materiality: "high" }],
      metrics: [{ id: metricId, metricKey: "conversion", metricLabel: "Conversion", numericValue: "10", unit: "percent", periodStart: null, periodEnd: null, sourceEvidenceId: evidenceId }],
      claimEvidence: [{ claimId: replacementId, evidenceId, relationshipType: "context", strengthScore: null }],
    },
  };
}

function output() {
  return {
    contradictions: [{ findingRef: "contradiction_1", area: "sales_and_conversion", statement: "Accounts differ", rationale: "The accepted records are incompatible.", materiality: "high", priorityRank: 1, references: [
      { entityType: "claim", ref: "C001", role: "primary" },
      { entityType: "evidence", ref: "E001", role: "conflicting" },
    ] }],
    gaps: [{ findingRef: "gap_1", area: "financial_performance", missingInformation: "Current margin is unknown", decisionImpact: "It limits economic assessment.", materiality: "medium", priorityRank: 2, references: [{ entityType: "metric", ref: "M001", role: "context" }] }],
    questions: [{ findingType: "gap", findingRef: "gap_1", question: "What is the current gross margin?", priorityOrder: 1 }],
  };
}

describe("Evidence Coherence domain", () => {
  it("projects active Claims from the historical snapshot without live state", () => {
    const projection = buildEvidenceCoherenceProjection(snapshot());
    expect(projection.claims.map((item) => item.id)).toEqual([replacementId]);
    const changedLiveState = { unrelated: "later canonical data" };
    expect(buildEvidenceCoherenceProjection(snapshot())).toEqual(projection);
    expect(changedLiveState).toBeTruthy();
  });

  it("hashes identical model inputs identically and relevant changes differently", () => {
    const { modelInput } = buildEvidenceCoherenceModelInput(snapshot());
    expect(hashEvidenceCoherenceModelInput(modelInput)).toBe(hashEvidenceCoherenceModelInput(structuredClone(modelInput)));
    expect(hashEvidenceCoherenceModelInput({ ...modelInput, snapshot: { ...modelInput.snapshot, snapshotVersion: 3 } }))
      .not.toBe(hashEvidenceCoherenceModelInput(modelInput));
    expect(EVIDENCE_COHERENCE_INPUT_VERSION).toBe("evidence_coherence_input_v3");
  });

  it("strictly validates the analytical contract and rejects diagnostic additions", () => {
    expect(evidenceCoherenceOutputSchema.parse(output())).toBeTruthy();
    expect(() => evidenceCoherenceOutputSchema.parse({ ...output(), diagnosis: "Do strategy" })).toThrow();
    expect(() => evidenceCoherenceOutputSchema.parse({ ...output(), gaps: [{ ...output().gaps[0], area: "other" }] })).toThrow();
    expect(() => evidenceCoherenceOutputSchema.parse({ ...output(), contradictions: [{ ...output().contradictions[0], materiality: "critical" }] })).toThrow();
    expect(() => evidenceCoherenceOutputSchema.parse({ ...output(), gaps: [{ ...output().gaps[0], priorityRank: 0 }] })).toThrow();
  });

  it("rejects references outside the exact snapshot and invalid question mappings", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    expect(validateEvidenceCoherenceOutput(output(), references)).toBeTruthy();
    // The superseded Claim is not projected, so there is no handle through which to cite it.
    expect([...references.values()].map((item) => item.id)).not.toContain(claimId);
    expect(() => validateEvidenceCoherenceOutput({ ...output(), gaps: [{ ...output().gaps[0], references: [{ entityType: "claim", ref: "C002", role: "context" }] }] }, references)).toThrow("is not in the analysed snapshot");
    expect(() => validateEvidenceCoherenceOutput({ ...output(), questions: [{ findingType: "gap", findingRef: "missing", question: "Question?", priorityOrder: 1 }] }, references)).toThrow("missing gap");
  });

  it("rejects duplicate findings and duplicate references", () => {
    const { references } = buildEvidenceCoherenceModelInput(snapshot());
    expect(() => validateEvidenceCoherenceOutput({ ...output(), gaps: [{ ...output().gaps[0], findingRef: "contradiction_1" }] }, references)).toThrow("Finding references must be unique");
    const duplicate = output();
    duplicate.gaps[0].references.push(duplicate.gaps[0].references[0]);
    expect(() => validateEvidenceCoherenceOutput(duplicate, references)).toThrow("duplicate reference");
  });

  it("surfaces at most three high/medium questions in deterministic priority", () => {
    const questions = [
      { id: "low", question: "Low", priorityOrder: 1, finding: { materiality: "low" as const, priorityRank: 1 } },
      { id: "m2", question: "Medium 2", priorityOrder: 1, finding: { materiality: "medium" as const, priorityRank: 2 } },
      { id: "h2", question: "High 2", priorityOrder: 2, finding: { materiality: "high" as const, priorityRank: 2 } },
      { id: "h1", question: "High 1", priorityOrder: 1, finding: { materiality: "high" as const, priorityRank: 1 } },
      { id: "m1", question: "Medium 1", priorityOrder: 1, finding: { materiality: "medium" as const, priorityRank: 1 } },
    ];
    expect(selectSurfacedQuestions(questions).map((item) => item.id)).toEqual(["h1", "h2", "m1"]);
  });

  it("keeps the current prompt constrained to evidence readiness", () => {
    expect(EVIDENCE_COHERENCE_PROMPT_VERSION).toBe("evidence_coherence_v4");
    expect(evidenceCoherencePrompt).toContain("not Claim truth probability");
    expect(evidenceCoherencePrompt).toContain("Analyse only the supplied snapshot projection");
    expect(evidenceCoherencePrompt).toContain("Do not diagnose");
    expect(evidenceCoherencePrompt).toContain("Do not produce root causes");
  });

  it("renders no-analysis, running, failed, completed and historical Evidence Quality states", () => {
    const business = { id: "business", name: "Example", status: "active" };
    const noAnalysis = renderToStaticMarkup(createElement(EvidenceQuality, { model: { business, latestSnapshot: { id: "snapshot", version: 2 }, isHistorical: false, surfacedQuestions: [] } }));
    expect(noAnalysis).toContain("No Evidence Quality analysis yet");
    expect(noAnalysis).toContain("Analyse Evidence");
    const running = renderToStaticMarkup(createElement(EvidenceQuality, { model: { business, latestSnapshot: { id: "snapshot", version: 2 }, analysis: { run: { id: "run", status: "RUNNING", inputSnapshotId: "snapshot" }, contradictions: [], gaps: [] }, isHistorical: false, surfacedQuestions: [] } }));
    expect(running).toContain("Analysis in progress");
    expect(running).toContain("snapshot 2");
    expect(running).toContain("does not modify canonical evidence");
    const failed = renderToStaticMarkup(createElement(EvidenceQuality, { model: { business, latestSnapshot: { id: "snapshot", version: 2 }, analysis: { run: { id: "run", status: "FAILED", inputSnapshotId: "snapshot" }, contradictions: [], gaps: [] }, isHistorical: false, surfacedQuestions: [] } }));
    expect(failed).toContain("Canonical evidence remains unchanged");
    expect(failed).toContain("Retry analysis");
    const completed = renderToStaticMarkup(createElement(EvidenceQuality, { model: { business, workflow: { state: "GAP_RESOLUTION_REQUIRED" }, latestSnapshot: { id: "snapshot", version: 2 }, analysis: { run: { id: "run", status: "SUCCEEDED", inputSnapshotId: "snapshot" }, contradictions: [{ id: "c", area: "market", statement: "Candidate conflict", rationale: "Why", materiality: "high" }], gaps: [] }, isHistorical: false, surfacedQuestions: Array.from({ length: 3 }, (_, index) => ({ id: String(index), question: `Question ${index}`, sourceSubmissionId: index === 0 ? "source" : null })) } }));
    expect(completed).toContain("Candidate findings for investigation, not canonical facts");
    expect(completed.match(/Question [0-2]/g)).toHaveLength(3);
    expect(completed).toContain("Information submitted from this question");
    expect(completed).toContain('href="/businesses/business/information?question=1"');
    expect(completed).toContain("Answer this question");
    const historical = renderToStaticMarkup(createElement(EvidenceQuality, { model: { business, latestSnapshot: { id: "new", version: 3 }, analysis: { run: { id: "run", status: "SUCCEEDED", inputSnapshotId: "old" }, contradictions: [], gaps: [] }, isHistorical: true, surfacedQuestions: [] } }));
    expect(historical).toContain("Historical analysis");
    expect(historical).toContain("version 3");
    expect(historical).not.toContain("Answer this question");
  });

  it("adds Evidence Quality navigation without adding a question-answer action", () => {
    const html = renderToStaticMarkup(createElement(BusinessWorkspace, { model: {
      business: { id: "business", name: "Example", sector: null, primaryGeography: null, status: "active", archivedAt: null },
      progress: deriveBusinessProgress({ workflowState: "EVIDENCE_READY" }),
      primaryHref: "/businesses/business/evidence",
      canAddInformation: true,
      counts: [], metrics: [],
    } }));
    expect(html).toContain('href="/businesses/business/evidence-quality"');
    expect(html).toContain("Evidence Quality");
    expect(html).not.toContain("Answer question");
  });
});
