export type ReviewQueueProposal = { id: string; proposalType: string };
export type ReviewQueueDecision = { proposalId: string; decision: string };

export function buildReviewQueue(proposals: ReviewQueueProposal[], reviews: ReviewQueueDecision[]) {
  const reviewedIds = new Set(reviews.map((review) => review.proposalId));
  const counts = reviews.reduce<Record<string, number>>((result, review) => {
    result[review.decision] = (result[review.decision] ?? 0) + 1;
    return result;
  }, {});
  const typeCounts = proposals.reduce<Record<string, number>>((result, proposal) => {
    result[proposal.proposalType] = (result[proposal.proposalType] ?? 0) + 1;
    return result;
  }, {});
  const reviewed = reviews.length;
  const total = proposals.length;
  return {
    current: proposals.find((proposal) => !reviewedIds.has(proposal.id)),
    reviewed,
    total,
    remaining: Math.max(0, total - reviewed),
    percent: total === 0 ? 100 : Math.round((reviewed / total) * 100),
    counts,
    typeCounts,
  };
}
