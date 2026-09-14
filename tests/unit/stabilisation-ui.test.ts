import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceExtractionFailedError } from "@/domain/evidence-extraction-error";
import { evidenceExtractionFailureTarget } from "@/domain/intake-retry";
import {
  ProposalReviewControls,
  type ReviewableProposal,
} from "../../app/proposal-review-controls";
import { RelationshipEndpoints } from "../../app/relationship-endpoints";

const proposal: ReviewableProposal = {
  id: "1c541bd3-539b-4bda-a3df-8c025db35608",
  proposalType: "claim",
  structuredPayload: {
    statement: "Annual revenue is approximately £80k.",
    claimType: "management_belief",
    subjectArea: "economics",
    confidenceLevel: "medium",
    confidenceScore: 0.6,
    confidenceBasis: { basis: "Founder notes" },
  },
};
const context = {
  businessId: "a4c72a72-d952-460e-a71c-63994ade4d41",
  extractionRunId: "465eb726-185d-4d42-91fd-eb119f48a3c3",
  reviewSessionId: "45a6c24c-b8c9-4ed3-ad28-b4425f0e52b3",
  reviewerId: "David",
};
const action = async () => undefined;

describe("Milestone 2 stabilisation UI", () => {
  it("renders the default review view without editable correction fields", () => {
    const html = renderToStaticMarkup(createElement(ProposalReviewControls, {
      proposal, context, reviewAction: action,
    }));
    expect(html).toContain(">Accept<");
    expect(html).toContain(">Edit<");
    expect(html).not.toContain("Save Correction");
    expect(html).not.toContain('name="statement"');
    expect(html).toContain("does not change the proposal");
    expect(html).toContain("cannot currently be changed");
  });

  it("renders only the correction workflow after Edit is entered", () => {
    const html = renderToStaticMarkup(createElement(ProposalReviewControls, {
      proposal, context, reviewAction: action, initialEditing: true,
    }));
    expect(html).toContain("Edit proposal");
    expect(html).toContain("Save Correction");
    expect(html).toContain(">Cancel<");
    expect(html).toContain('name="statement"');
    expect(html).not.toContain("Edit &amp; Accept");
  });

  it("renders human-readable relationship endpoints before internal refs", () => {
    const html = renderToStaticMarkup(createElement(RelationshipEndpoints, {
      relationship: {
        claimRef: "claim_1", evidenceRef: "evidence_1", relationshipType: "supports",
      },
      proposals: [
        { proposalRef: "claim_1", structuredPayload: { statement: "Revenue is approximately £80k." } },
        { proposalRef: "evidence_1", structuredPayload: { statement: "Founder records report £80k revenue." } },
      ],
    }));
    expect(html).toContain("Revenue is approximately £80k.");
    expect(html).toContain("Founder records report £80k revenue.");
    expect(html.indexOf("Revenue is approximately £80k.")).toBeLessThan(html.indexOf("claim_1"));
  });

  it("builds a safe retry URL that references persisted intake without embedding it", () => {
    const rawIntake = "Sensitive business intake must not appear in the URL";
    const target = evidenceExtractionFailureTarget(
      context.businessId,
      new EvidenceExtractionFailedError(context.extractionRunId, new Error(rawIntake)),
    );
    expect(target).toContain(`failedRun=${context.extractionRunId}`);
    expect(target).toContain("intake+has+been+preserved");
    expect(target).not.toContain("Sensitive");
  });
});
