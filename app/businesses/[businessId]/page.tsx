import { notFound } from "next/navigation";
import { getBusinessOverviewService, getEvidenceStateService } from "@/foundation";
import { BusinessWorkspace } from "../../business-workspace";
import { selectWorkspaceKeyMetrics } from "@/domain/workspace-metrics";

export const dynamic = "force-dynamic";

export default async function BusinessWorkspacePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const [overview, state] = await Promise.all([
    getBusinessOverviewService().get(businessId),
    getEvidenceStateService().getCurrent(businessId).catch(() => undefined),
  ]);
  if (!overview || !state) notFound();
  const counts = [
    { singular: "Observation", plural: "Observations", value: state.claims.observations.length },
    { singular: "Management belief", plural: "Management beliefs", value: state.claims.managementBeliefs.length },
    { singular: "Hypothesis", plural: "Hypotheses", value: state.claims.hypotheses.length },
    { singular: "Unknown", plural: "Unknowns", value: state.claims.unknowns.length },
    { singular: "Metric", plural: "Metrics", value: state.metrics.length },
    { singular: "Relationship", plural: "Relationships", value: state.relationships.length },
  ];
  const activeReviewHref = overview.reviewSession?.status === "OPEN" && overview.latestExtraction
    ? `/businesses/${businessId}/reviews/${overview.latestExtraction.id}`
    : undefined;
  const workspaceProgress = overview.reviewSession?.status === "COMPLETED" || overview.workflow?.state === "EVIDENCE_READY"
    ? { ...overview.progress, primaryActionLabel: "View Evidence State →" }
    : overview.progress;
  const workspacePrimaryHref = workspaceProgress === overview.progress
    ? overview.primaryHref
    : `/businesses/${businessId}/evidence`;
  return <BusinessWorkspace model={{
    business: overview.business,
    progress: workspaceProgress,
    primaryHref: workspacePrimaryHref,
    activeReviewHref,
    canAddInformation: overview.workflow?.state !== "EVIDENCE_READY",
    counts,
    metrics: selectWorkspaceKeyMetrics(state.metrics),
  }} />;
}
