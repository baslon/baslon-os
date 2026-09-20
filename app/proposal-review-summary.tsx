import { RelationshipEndpoints } from "./relationship-endpoints";
import { ProposalNumericValue } from "./proposal-numeric-value";
import {
  reviewCardRows,
  type ApplicationProvenance,
  type ReviewProposalType,
} from "@/domain/review-card";

const proposalLabels: Record<ReviewProposalType, string> = {
  claim: "Claim",
  evidence: "Evidence",
  metric: "Metric",
  claim_evidence: "Relationship",
};

function display(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

type ProposalSummary = {
  id: string;
  proposalRef: string;
  proposalType: ReviewProposalType;
  structuredPayload: Record<string, unknown>;
};

/**
 * The pending review card: everything Accept will persist for this proposal
 * (M4-11). AI-proposed values are labelled as such; provenance is shown
 * read-only and comes from the extraction run, not the model (N-1).
 */
export function ProposalReviewSummary({ proposal, proposals, provenance, extractionRunId, reviewerId }: {
  proposal: ProposalSummary;
  proposals: ProposalSummary[];
  provenance: ApplicationProvenance;
  extractionRunId: string;
  reviewerId: string | null;
}) {
  const payload = proposal.structuredPayload;
  const sourceEvidence = typeof payload.sourceEvidenceRef === "string"
    ? proposals.find((item) => item.proposalRef === payload.sourceEvidenceRef)
    : undefined;
  const rows = reviewCardRows({
    proposalType: proposal.proposalType,
    payload,
    provenance,
    extractionRunId,
    proposalId: proposal.id,
    reviewerId,
    sourceEvidenceStatement: typeof sourceEvidence?.structuredPayload.statement === "string"
      ? sourceEvidence.structuredPayload.statement
      : null,
  });
  const details = rows.filter((row) => row.group === "details");
  const provenanceRows = rows.filter((row) => row.group === "provenance");

  return <>
    <p className="eyebrow">{proposalLabels[proposal.proposalType]}</p>
    <h2>{display(payload.statement ?? payload.metricLabel ?? payload.relationshipType)}</h2>
    <div className="proposal-attributes">
      {payload.claimType ? <span>{display(payload.claimType).replaceAll("_", " ")}</span> : null}
      {payload.confidenceLevel ? <span>{display(payload.confidenceLevel)} confidence</span> : null}
      {payload.materiality ? <span>{display(payload.materiality)} materiality</span> : null}
    </div>
    {payload.sourceExcerpt ? <div className="source-block"><p className="eyebrow">Source</p><blockquote>{display(payload.sourceExcerpt)}</blockquote></div> : null}
    {proposal.proposalType === "claim_evidence" ? <RelationshipEndpoints relationship={payload} proposals={proposals} /> : null}
    <ProposalNumericValue proposalType={proposal.proposalType} payload={payload} />
    {details.length > 0 ? <section className="review-record-details" aria-label="Recorded if you accept">
      <h3>Recorded if you accept</h3>
      <p className="note">These values were proposed by AI. Accepting records them as reviewed; use Correct proposal to change any of them.</p>
      <dl>{details.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    </section> : null}
    {provenanceRows.length > 0 ? <details className="review-provenance">
      <summary>Provenance (recorded by Baslon OS, read-only)</summary>
      <dl>{provenanceRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    </details> : null}
  </>;
}
