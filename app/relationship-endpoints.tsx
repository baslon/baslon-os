type ProposalSummary = {
  proposalRef: string;
  structuredPayload: Record<string, unknown>;
};

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "Unavailable";
}

export function RelationshipEndpoints({
  relationship,
  proposals,
}: {
  relationship: Record<string, unknown>;
  proposals: ProposalSummary[];
}) {
  const claim = proposals.find((item) => item.proposalRef === relationship.claimRef);
  const evidence = proposals.find((item) => item.proposalRef === relationship.evidenceRef);
  return <div className="relationship-endpoints">
    <div><strong>Claim</strong><p>{text(claim?.structuredPayload.statement)}</p></div>
    <div className="relationship-arrow" aria-hidden="true">↓</div>
    <div><strong>Relationship</strong><p>{text(relationship.relationshipType)}</p>
      {relationship.strengthScore !== null && relationship.strengthScore !== undefined
        ? <p>Semantic-link confidence: {text(relationship.strengthScore)}</p>
        : null}
      <p className="note">This score reflects confidence that the relationship type is appropriate. It is not evidence credibility or claim truth.</p>
    </div>
    <div className="relationship-arrow" aria-hidden="true">↓</div>
    <div><strong>Evidence</strong><p>{text(evidence?.structuredPayload.statement)}</p></div>
  </div>;
}
