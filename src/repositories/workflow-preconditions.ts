import { and, desc, eq, inArray } from "drizzle-orm";
import {
  analysisRuns,
  approvedDiagnoses,
  businessStateSnapshots,
  diagnosisItemReviews,
  workflowTransitions,
} from "@/db/schema";
import { EVIDENCE_COHERENCE_MODULE } from "@/domain/evidence-coherence";
import { PHASE1_DIAGNOSIS_MODULE } from "@/domain/phase1-diagnosis";
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

async function latestSnapshotId(database: Parameters<WorkflowTransitionPrecondition>[0]["database"], businessId: string) {
  const [latest] = await database.select({ id: businessStateSnapshots.id })
    .from(businessStateSnapshots)
    .where(eq(businessStateSnapshots.businessId, businessId))
    .orderBy(desc(businessStateSnapshots.version)).limit(1);
  return latest?.id;
}

/**
 * Phase 1 Diagnosis may only start on the latest snapshot, from the exact
 * snapshot and Evidence Coherence run the human last continued with.
 */
export const generatePhase1Precondition: WorkflowTransitionPrecondition = async ({
  businessId,
  workflow,
  metadata,
  database,
}) => {
  const { snapshotId, coherenceRunId } = metadata;
  if (typeof snapshotId !== "string" || typeof coherenceRunId !== "string") {
    throw new Error("Phase 1 Diagnosis must record its snapshot and continued-with Evidence Coherence run");
  }
  if (await latestSnapshotId(database, businessId) !== snapshotId) {
    throw new Error("Phase 1 Diagnosis must use the latest canonical snapshot");
  }
  const [continuation] = await database.select({ metadata: workflowTransitions.metadata })
    .from(workflowTransitions).where(and(
      eq(workflowTransitions.workflowId, workflow.id),
      eq(workflowTransitions.event, "CONTINUE_WITH_GAPS"),
    )).orderBy(desc(workflowTransitions.createdAt)).limit(1);
  if (continuation?.metadata.snapshotId !== snapshotId || continuation.metadata.analysisRunId !== coherenceRunId) {
    throw new Error("Phase 1 Diagnosis must use the snapshot and analysis the Business continued with");
  }
  const [run] = await database.select({ id: analysisRuns.id }).from(analysisRuns).where(and(
    eq(analysisRuns.id, coherenceRunId),
    eq(analysisRuns.businessId, businessId),
    eq(analysisRuns.module, EVIDENCE_COHERENCE_MODULE),
    eq(analysisRuns.status, "SUCCEEDED"),
    eq(analysisRuns.inputSnapshotId, snapshotId),
  ));
  if (!run) throw new Error("The continued-with Evidence Coherence analysis is not valid for this snapshot");
};

/**
 * Leaving PHASE1_ANALYSING requires a successful diagnosis of the latest
 * snapshot; a failed run cannot advance the workflow. Other
 * MARK_ANALYSIS_COMPLETE transitions are unaffected.
 */
export const markAnalysisCompletePrecondition: WorkflowTransitionPrecondition = async ({
  businessId,
  workflow,
  metadata,
  database,
}) => {
  if (workflow.state !== "PHASE1_ANALYSING") return;
  const { analysisRunId } = metadata;
  if (typeof analysisRunId !== "string") throw new Error("Diagnosis completion must record its analysis run");
  const [run] = await database.select({ inputSnapshotId: analysisRuns.inputSnapshotId }).from(analysisRuns).where(and(
    eq(analysisRuns.id, analysisRunId),
    eq(analysisRuns.businessId, businessId),
    eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
    eq(analysisRuns.status, "SUCCEEDED"),
  ));
  if (!run || run.inputSnapshotId !== await latestSnapshotId(database, businessId)) {
    throw new Error("Only a successful diagnosis of the latest snapshot can reach human review");
  }
};

/**
 * Approval requires the immutable approved-diagnosis artifact of the current
 * diagnosis of the latest snapshot, produced by a completed human review.
 */
export const approvePhase1Precondition: WorkflowTransitionPrecondition = async ({
  businessId,
  metadata,
  database,
}) => {
  const { approvedDiagnosisId } = metadata;
  if (typeof approvedDiagnosisId !== "string") throw new Error("Approval must record the approved diagnosis");
  const [approved] = await database.select({
    analysisRunId: approvedDiagnoses.analysisRunId,
    snapshotId: approvedDiagnoses.snapshotId,
    reviewSessionId: approvedDiagnoses.reviewSessionId,
  }).from(approvedDiagnoses).where(and(
    eq(approvedDiagnoses.id, approvedDiagnosisId),
    eq(approvedDiagnoses.businessId, businessId),
  ));
  if (!approved) throw new Error("Approved diagnosis not found");
  const [surviving] = await database.select({ id: diagnosisItemReviews.id }).from(diagnosisItemReviews).where(and(
    eq(diagnosisItemReviews.reviewSessionId, approved.reviewSessionId),
    eq(diagnosisItemReviews.businessId, businessId),
    inArray(diagnosisItemReviews.decision, ["ACCEPTED", "CORRECTED"]),
  )).limit(1);
  if (!surviving) throw new Error("An all-rejected diagnosis cannot be approved");
  const [latestRun] = await database.select({ id: analysisRuns.id }).from(analysisRuns).where(and(
    eq(analysisRuns.businessId, businessId),
    eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
    eq(analysisRuns.status, "SUCCEEDED"),
  )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(1);
  if (latestRun?.id !== approved.analysisRunId || approved.snapshotId !== await latestSnapshotId(database, businessId)) {
    throw new Error("Only the current diagnosis of the latest snapshot can be approved");
  }
};

/** Preconditions every Strategy Orchestrator enforces by default. */
export const defaultWorkflowTransitionPreconditions: WorkflowTransitionPreconditions = {
  CONTINUE_WITH_GAPS: continueWithGapsPrecondition,
  GENERATE_PHASE1: generatePhase1Precondition,
  MARK_ANALYSIS_COMPLETE: markAnalysisCompletePrecondition,
  APPROVE_PHASE1: approvePhase1Precondition,
};
