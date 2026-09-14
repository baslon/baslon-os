export function buildEvidenceStateSummary(input: {
  facts: number;
  observations: number;
  managementBeliefs: number;
  hypotheses: number;
  aiInferences: number;
  unknowns: number;
  evidence: number;
  metrics: number;
  relationships: number;
}) {
  const claimTypes = [
    { singular: "Fact", plural: "Facts", value: input.facts },
    { singular: "Observation", plural: "Observations", value: input.observations },
    { singular: "Management belief", plural: "Management beliefs", value: input.managementBeliefs },
    { singular: "Hypothesis", plural: "Hypotheses", value: input.hypotheses },
    { singular: "AI inference", plural: "AI inferences", value: input.aiInferences },
    { singular: "Unknown", plural: "Unknowns", value: input.unknowns },
  ];
  return {
    primary: [
      { singular: "Claim", plural: "Claims", value: claimTypes.reduce((total, item) => total + item.value, 0) },
      { singular: "Evidence", plural: "Evidence", value: input.evidence },
      { singular: "Metric", plural: "Metrics", value: input.metrics },
      { singular: "Relationship", plural: "Relationships", value: input.relationships },
    ],
    claimTypes,
  };
}
