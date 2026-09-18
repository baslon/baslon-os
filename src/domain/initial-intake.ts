import { isAiRunStale } from "@/domain/ai-run-recovery";
import { acceptsAddInformation, type WorkflowState } from "@/domain/workflow";

export type InitialIntakeRun = {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  sourceSubmissionId: string | null;
  createdAt: Date;
};

export type InitialIntakeAvailability =
  | { kind: "available"; staleRunId?: string }
  | { kind: "review_in_progress"; runId: string }
  | { kind: "analysis_running"; runId: string }
  | { kind: "use_add_information" }
  | { kind: "unavailable" };

const intakeStates: readonly WorkflowState[] = ["NEW", "INTAKE_IN_PROGRESS", "INTAKE_READY"];

/**
 * Initial intake may start a new extraction only when no current run exists for
 * the initial cycle, or the latest one has failed or been abandoned. Starting a
 * run while a successful run awaits review would silently invalidate that review.
 */
export function initialIntakeAvailability(input: {
  workflowState: WorkflowState;
  latestRun?: InitialIntakeRun;
  now?: Date;
}): InitialIntakeAvailability {
  if (intakeStates.includes(input.workflowState)) return { kind: "available" };
  if (acceptsAddInformation(input.workflowState)) return { kind: "use_add_information" };
  if (input.workflowState !== "EVIDENCE_PROCESSING") return { kind: "unavailable" };

  const latest = input.latestRun;
  if (!latest) return { kind: "available" };
  if (latest.sourceSubmissionId) return { kind: "use_add_information" };
  if (latest.status === "FAILED") return { kind: "available" };
  if (latest.status === "SUCCEEDED") return { kind: "review_in_progress", runId: latest.id };
  return isAiRunStale(latest.createdAt, input.now)
    ? { kind: "available", staleRunId: latest.id }
    : { kind: "analysis_running", runId: latest.id };
}

export class InitialIntakeUnavailableError extends Error {
  constructor(readonly availability: Exclude<InitialIntakeAvailability, { kind: "available" }>) {
    super(`Initial intake is not available: ${availability.kind}`);
    this.name = "InitialIntakeUnavailableError";
  }
}
