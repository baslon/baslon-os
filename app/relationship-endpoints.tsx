type ProposalSummary = {
  proposalRef: string;
  structuredPayload: Record<string, unknown>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "Unavailable";
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
    <p><strong>Claim:</strong><br />{text(claim?.structuredPayload.statement)}</p>
    <p><strong>Relationship:</strong><br />{text(relationship.relationshipType)}</p>
    <p><strong>Evidence:</strong><br />{text(evidence?.structuredPayload.statement)}</p>
    <p className="note">Internal refs: {text(relationship.claimRef)} → {text(relationship.evidenceRef)} (not editable)</p>
  </div>;
}
