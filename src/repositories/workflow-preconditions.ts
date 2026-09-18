import { and, desc, eq } from "drizzle-orm";
import { analysisRuns, businessStateSnapshots } from "@/db/schema";
import { EVIDENCE_COHERENCE_MODULE } from "@/domain/evidence-coherence";
import type {
  WorkflowTransitionPrecondition,
  WorkflowTransitionPreconditions,
} from "@/strategy/orchestrator";

/**
 * Phase 1 entry must be anchored to evidence that has actually been analysed:
 * the recorded snapshot must be the Business's latest snapshot, and the
 * recorded run a successful Evidence Coherence analysis of that snapshot.
 * Runs inside the transition transaction after the Business and workflow locks,
 * and snapshot creation takes the same Business lock, so the check cannot go
 * stale before commit.
 */
export const continueWithGapsPrecondition: WorkflowTransitionPrecondition = async ({
  businessId,
  metadata,
  database,
}) => {
  const { snapshotId, analysisRunId } = metadata;
  if (typeof snapshotId !== "string" || typeof analysisRunId !== "string") {
    throw new Error("Continuing with gaps must record the accepted snapshot and Evidence Coherence run");
  }
  const [latest] = await database.select({ id: businessStateSnapshots.id })
    .from(businessStateSnapshots)
    .where(eq(businessStateSnapshots.businessId, businessId))
    .orderBy(desc(businessStateSnapshots.version)).limit(1);
  if (!latest || latest.id !== snapshotId) {
    throw new Error("Continuing with gaps must use the latest canonical snapshot");
  }
  const [run] = await database.select({ id: analysisRuns.id }).from(analysisRuns).where(and(
    eq(analysisRuns.id, analysisRunId),
    eq(analysisRuns.businessId, businessId),
    eq(analysisRuns.module, EVIDENCE_COHERENCE_MODULE),
    eq(analysisRuns.status, "SUCCEEDED"),
    eq(analysisRuns.inputSnapshotId, snapshotId),
  ));
  if (!run) {
    throw new Error("The latest snapshot has no successful Evidence Coherence analysis");
  }
};

/** Preconditions every Strategy Orchestrator enforces by default. */
export const defaultWorkflowTransitionPreconditions: WorkflowTransitionPreconditions = {
  CONTINUE_WITH_GAPS: continueWithGapsPrecondition,
};
