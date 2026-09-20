import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  claimEvidenceProposalSchema,
  claimProposalSchema,
  reviewableEvidenceProposalSchema,
  reviewableMetricProposalSchema,
} from "@/ai/evidence-extractor/contracts";
import {
  applicationProvenance,
  legacyReviewCardWarning,
  LEGACY_REVIEW_CARD_WARNING,
  REVIEW_CARD_VERSION,
  reviewCardManifest,
  reviewCardRows,
  reviewCardVersionOf,
  rowCoverage,
  UNRECORDED_SOURCE_TYPE,
  type ReviewProposalType,
} from "@/domain/review-card";
import { ProposalReviewSummary } from "../../app/proposal-review-summary";
import { ProposalCorrectionFields } from "../../app/proposal-review-controls";

const schemaKeys: Record<ReviewProposalType, string[]> = {
  claim: Object.keys(claimProposalSchema.shape),
  evidence: Object.keys(reviewableEvidenceProposalSchema.shape),
  metric: Object.keys(reviewableMetricProposalSchema.shape),
  claim_evidence: Object.keys(claimEvidenceProposalSchema.shape),
};

// Distinctive values so every rendered field can be located unambiguously.
const claim = {
  proposalRef: "claim_1", statement: "CLAIM-STATEMENT", claimType: "management_belief",
  subjectArea: "SUBJECT-AREA", confidenceLevel: "CONFIDENCE-LEVEL", confidenceScore: 0.37,
  confidenceBasis: { basis: "CONFIDENCE-BASIS" }, sourceType: "MODEL-SOURCE-TYPE",
};
const evidence = {
  proposalRef: "evidence_1", evidenceType: "EVIDENCE-TYPE", statement: "EVIDENCE-STATEMENT",
  valueNumeric: null, valuePrecision: "range", valueLower: 1000, valueUpper: 6000,
  valueText: "VALUE-TEXT", unit: "GBP", periodStart: "2024-10-31", periodEnd: "2026-08-30",
  sourceType: "MODEL-SOURCE-TYPE", sourceReference: "MODEL-SOURCE-REFERENCE",
  sourceMetadata: { suppliedBy: "MODEL-SUPPLIED-BY", notes: "SOURCE-NOTES" },
  reliabilityLevel: "RELIABILITY-LEVEL", reliabilityScore: 0.61, directnessLevel: "DIRECTNESS-LEVEL",
  recencyLevel: "RECENCY-LEVEL", rawPayload: { excerpt: "MODEL-RAW-EXCERPT" }, materiality: "MATERIALITY-LEVEL",
  sourceExcerpt: "SOURCE-EXCERPT",
};
const metric = {
  proposalRef: "metric_1", metricKey: "METRIC-KEY", metricLabel: "METRIC-LABEL",
  numericValue: 3200, numericPrecision: "approximate", numericLower: null, numericUpper: null,
  unit: "GBP", periodStart: "2025-01-01", periodEnd: "2025-12-31",
  dimensionData: { dimension: "DIMENSION-NAME", value: "DIMENSION-VALUE" },
  sourceEvidenceRef: "evidence_1", sourceExcerpt: "METRIC-EXCERPT",
};
const relationship = {
  proposalRef: "relationship_1", claimRef: "claim_1", evidenceRef: "evidence_1",
  relationshipType: "supports", strengthScore: 0.83,
};
const proposals = [
  { id: "p-claim", proposalRef: "claim_1", proposalType: "claim" as const, structuredPayload: claim },
  { id: "p-evidence", proposalRef: "evidence_1", proposalType: "evidence" as const, structuredPayload: evidence },
  { id: "p-metric", proposalRef: "metric_1", proposalType: "metric" as const, structuredPayload: metric },
  { id: "p-relationship", proposalRef: "relationship_1", proposalType: "claim_evidence" as const, structuredPayload: relationship },
];
const provenance = applicationProvenance({
  sourceType: "RUN-SOURCE-TYPE",
  sourceReference: "RUN-SOURCE-REFERENCE",
  sourceMetadata: { suppliedBy: "RUN-SUPPLIED-BY" },
});

function card(proposalType: ReviewProposalType) {
  const proposal = proposals.find((item) => item.proposalType === proposalType)!;
  return renderToStaticMarkup(createElement(ProposalReviewSummary, {
    proposal, proposals, provenance, extractionRunId: "RUN-ID", reviewerId: "REVIEWER-ID",
  })).replaceAll("&amp;", "&");
}

describe("M4-11 review-card completeness", () => {
  it("accounts for every persisted proposal field of every proposal type", () => {
    for (const proposalType of Object.keys(schemaKeys) as ReviewProposalType[]) {
      expect(Object.keys(reviewCardManifest[proposalType]).sort(), proposalType)
        .toEqual([...schemaKeys[proposalType]].sort());
    }
  });

  it.each(["claim", "evidence", "metric"] as const)(
    "renders every %s detail and provenance field with the value Accept will persist",
    (proposalType) => {
      const proposal = proposals.find((item) => item.proposalType === proposalType)!;
      const rows = reviewCardRows({
        proposalType, payload: proposal.structuredPayload, provenance,
        extractionRunId: "RUN-ID", proposalId: proposal.id, reviewerId: "REVIEWER-ID",
        sourceEvidenceStatement: "EVIDENCE-STATEMENT",
      });
      const covered = new Set(rows.flatMap(rowCoverage));
      const required = Object.entries(reviewCardManifest[proposalType])
        .filter(([, location]) => location === "details" || location === "provenance")
        .map(([field]) => field);
      for (const field of required) expect(covered.has(field), `${proposalType}.${field}`).toBe(true);
      const html = card(proposalType);
      for (const row of rows) {
        expect(html, `${proposalType} ${row.label}`).toContain(row.label);
        expect(html, `${proposalType} ${row.label}`).toContain(row.value);
      }
    },
  );

  it("shows the headline, attribute, source and numeric fields already on the card", () => {
    expect(card("claim")).toContain("CLAIM-STATEMENT");
    expect(card("claim")).toContain("management belief");
    expect(card("claim")).toContain("CONFIDENCE-LEVEL confidence");
    const evidenceHtml = card("evidence");
    for (const text of ["EVIDENCE-STATEMENT", "MATERIALITY-LEVEL materiality", "SOURCE-EXCERPT", "£1,000–£6,000", "Precision: Range"]) {
      expect(evidenceHtml).toContain(text);
    }
    const metricHtml = card("metric");
    for (const text of ["METRIC-LABEL", "METRIC-EXCERPT", "about £3,200", "Precision: Approximate"]) {
      expect(metricHtml).toContain(text);
    }
  });

  it("shows every AI-proposed Evidence qualifier and the Metric's source Evidence", () => {
    const evidenceHtml = card("evidence");
    for (const text of ["EVIDENCE-TYPE", "VALUE-TEXT", "31 Oct 2024 – 30 Aug 2026", "RELIABILITY-LEVEL", "0.61", "DIRECTNESS-LEVEL", "RECENCY-LEVEL", "SOURCE-NOTES"]) {
      expect(evidenceHtml).toContain(text);
    }
    const metricHtml = card("metric");
    for (const text of ["METRIC-KEY", "DIMENSION-NAME: DIMENSION-VALUE", "EVIDENCE-STATEMENT (evidence_1)", "1 Jan 2025 – 31 Dec 2025"]) {
      expect(metricHtml).toContain(text);
    }
    const claimHtml = card("claim");
    for (const text of ["SUBJECT-AREA", "0.37", "CONFIDENCE-BASIS"]) expect(claimHtml).toContain(text);
  });

  it("shows run provenance read-only and never the model's own provenance text", () => {
    for (const proposalType of ["claim", "evidence"] as const) {
      const html = card(proposalType);
      expect(html).toContain("Provenance (recorded by Baslon OS, read-only)");
      expect(html).toContain("RUN-SOURCE-TYPE");
      expect(html).not.toContain("MODEL-SOURCE-TYPE");
    }
    const evidenceHtml = card("evidence");
    for (const text of ["RUN-SOURCE-REFERENCE", "RUN-SUPPLIED-BY", "RUN-ID", "p-evidence", "REVIEWER-ID"]) {
      expect(evidenceHtml).toContain(text);
    }
    for (const text of ["MODEL-SOURCE-REFERENCE", "MODEL-SUPPLIED-BY", "MODEL-RAW-EXCERPT"]) {
      expect(evidenceHtml).not.toContain(text);
    }
    for (const proposal of proposals) {
      const form = renderToStaticMarkup(createElement(ProposalCorrectionFields, { proposal }));
      for (const name of ["sourceType", "sourceReference", "suppliedBy", "extractionRunId", "proposalId", "rawPayload"]) {
        expect(form, `${proposal.proposalType} ${name}`).not.toContain(`name="${name}"`);
      }
    }
  });

  it("falls back to an application label, not model text, when a run recorded no channel", () => {
    expect(applicationProvenance({ sourceType: null, sourceReference: null, sourceMetadata: {} }))
      .toEqual({ sourceType: UNRECORDED_SOURCE_TYPE, sourceReference: null, suppliedBy: null });
  });

  it("makes Evidence type, source notes and Metric dimensions correctable", () => {
    const evidenceForm = renderToStaticMarkup(createElement(ProposalCorrectionFields, { proposal: proposals[1] }));
    expect(evidenceForm).toContain('name="evidenceType" value="EVIDENCE-TYPE"');
    expect(evidenceForm).toContain('name="sourceNotes" value="SOURCE-NOTES"');
    const metricForm = renderToStaticMarkup(createElement(ProposalCorrectionFields, { proposal: proposals[2] }));
    expect(metricForm).toContain('name="dimension" value="DIMENSION-NAME"');
    expect(metricForm).toContain('name="dimensionValue" value="DIMENSION-VALUE"');
  });

  it("leaves relationship review unchanged", () => {
    const html = card("claim_evidence");
    expect(html).toContain("CLAIM-STATEMENT");
    expect(html).toContain("EVIDENCE-STATEMENT");
    expect(html).toContain("Semantic-link confidence: 0.83");
    expect(html).not.toContain("Recorded if you accept");
    expect(reviewCardRows({
      proposalType: "claim_evidence", payload: relationship, provenance, extractionRunId: "RUN-ID", proposalId: "p-relationship",
    })).toEqual([]);
    const form = renderToStaticMarkup(createElement(ProposalCorrectionFields, { proposal: proposals[3] }));
    expect(form.match(/name="/g)).toHaveLength(2);
    expect(form).toContain('name="relationshipType"');
    expect(form).toContain('name="strengthScore"');
  });

  it("labels records without the review-card marker and not records that carry it", () => {
    const stamped = { evidenceReview: { reviewSessionId: "s", reviewCardVersion: REVIEW_CARD_VERSION } };
    const legacy = { evidenceReview: { reviewSessionId: "s" } };
    expect(reviewCardVersionOf(stamped)).toBe("m4_11_v1");
    expect(legacyReviewCardWarning(stamped)).toBeNull();
    expect(legacyReviewCardWarning(legacy)).toBe(LEGACY_REVIEW_CARD_WARNING);
    expect(legacyReviewCardWarning({})).toBe(LEGACY_REVIEW_CARD_WARNING);
    expect(LEGACY_REVIEW_CARD_WARNING).toBe("Qualifiers were AI-assigned and were not all displayed at the original review.");
  });
});
