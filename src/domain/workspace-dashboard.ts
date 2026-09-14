type WorkspaceBusiness = {
  business: { id: string; name: string };
  workflow?: { state: string };
  latestExtraction?: { status: "RUNNING" | "SUCCEEDED" | "FAILED" };
  reviewSession?: { status: "OPEN" | "COMPLETED" };
  currentReviewedCount: number;
  currentProposalCount: number;
  lastActivityAt: Date;
  primaryHref: string;
  progress: { statusLabel: string };
};

function attentionPriority(item: WorkspaceBusiness): number | undefined {
  if (item.latestExtraction?.status === "FAILED") return 1;
  if (item.reviewSession?.status === "OPEN") return 2;
  if (item.latestExtraction?.status === "SUCCEEDED" && item.reviewSession?.status !== "COMPLETED") return 3;
  if (["NEW", "INTAKE_IN_PROGRESS", "INTAKE_READY"].includes(item.workflow?.state ?? "NEW")) return 4;
  return undefined;
}

function stableRecentSort(left: WorkspaceBusiness, right: WorkspaceBusiness) {
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
    || left.business.id.localeCompare(right.business.id);
}

function attentionPresentation(item: WorkspaceBusiness, priority: number) {
  if (priority === 1) return {
    status: "Analysis failed — retry required",
    detail: "The business information has been saved and is ready to analyse again.",
    actionLabel: "Retry analysis →",
  };
  if (priority === 2) return {
    status: "Evidence review in progress",
    detail: `${item.currentReviewedCount} of ${item.currentProposalCount} proposals reviewed`,
    actionLabel: "Continue review →",
  };
  if (priority === 3) return {
    status: "Evidence ready for review",
    detail: `${item.currentProposalCount} proposals are ready for review.`,
    actionLabel: "Review findings →",
  };
  if (item.workflow?.state === "INTAKE_READY") return {
    status: "Business information ready",
    detail: "Information has been added but analysis has not been completed.",
    actionLabel: "Analyse information →",
  };
  return {
    status: "Business information needed",
    detail: "Add business information to begin building the Evidence State.",
    actionLabel: "Add business information →",
  };
}

export function buildWorkspaceDashboard<T extends WorkspaceBusiness>(businesses: T[]) {
  const attention = businesses.flatMap((business) => {
    const priority = attentionPriority(business);
    return priority === undefined ? [] : [{ business, priority, ...attentionPresentation(business, priority) }];
  }).toSorted((left, right) => left.priority - right.priority || stableRecentSort(left.business, right.business));

  return {
    summary: {
      total: businesses.length,
      awaitingReview: businesses.filter((item) => item.reviewSession?.status === "OPEN"
        || (item.latestExtraction?.status === "SUCCEEDED" && item.reviewSession?.status !== "COMPLETED")).length,
      failedAnalyses: businesses.filter((item) => item.latestExtraction?.status === "FAILED").length,
      completedReviews: businesses.filter((item) => item.reviewSession?.status === "COMPLETED").length,
    },
    attention,
    recent: businesses
      .filter((business) => !attention.some((item) => item.business.business.id === business.business.id))
      .toSorted(stableRecentSort)
      .slice(0, 5),
  };
}
