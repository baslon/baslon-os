import { z } from "zod";

export const workflowStates = [
  "NEW", "INTAKE_IN_PROGRESS", "INTAKE_READY", "EVIDENCE_PROCESSING",
  "EVIDENCE_READY", "GAP_ANALYSIS", "GAP_RESOLUTION_REQUIRED",
  "PHASE1_READY", "PHASE1_ANALYSING", "PHASE1_AWAITING_REVIEW",
  "REVISION_REQUIRED", "PHASE1_APPROVED",
] as const;
export const workflowEvents = [
  "START_INTAKE", "SUBMIT_INTAKE", "ADD_EVIDENCE", "MARK_UNKNOWN",
  "CONTINUE_WITH_GAPS", "GENERATE_PHASE1", "APPROVE_PHASE1",
  "REQUEST_REVISION", "REJECT_PHASE1", "PROCESS_EVIDENCE",
  "RUN_GAP_ANALYSIS", "MARK_ANALYSIS_COMPLETE",
] as const;
export const actorTypes = ["human", "system", "ai"] as const;

export type WorkflowState = (typeof workflowStates)[number];
export type WorkflowEvent = (typeof workflowEvents)[number];
export type ActorType = (typeof actorTypes)[number];
export type AuthorizedWorkflowTransition = Readonly<{
  businessId: string;
  workflowId: string;
  expectedVersion: number;
  fromState: WorkflowState;
  toState: WorkflowState;
  event: WorkflowEvent;
  actorType: ActorType;
  actorId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
}>;

const authorizedTransitions = new WeakSet<object>();

export const transitionInputSchema = z.object({
  businessId: z.uuid(),
  event: z.enum(workflowEvents),
  actorType: z.enum(actorTypes),
  actorId: z.string().min(1).optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

type Rule = { from: WorkflowState; event: WorkflowEvent; to: WorkflowState };

export const transitionRules: readonly Rule[] = [
  { from: "NEW", event: "START_INTAKE", to: "INTAKE_IN_PROGRESS" },
  { from: "INTAKE_IN_PROGRESS", event: "SUBMIT_INTAKE", to: "INTAKE_READY" },
  { from: "INTAKE_READY", event: "PROCESS_EVIDENCE", to: "EVIDENCE_PROCESSING" },
  { from: "EVIDENCE_PROCESSING", event: "MARK_ANALYSIS_COMPLETE", to: "EVIDENCE_READY" },
  { from: "EVIDENCE_READY", event: "RUN_GAP_ANALYSIS", to: "GAP_ANALYSIS" },
  { from: "EVIDENCE_READY", event: "ADD_EVIDENCE", to: "EVIDENCE_PROCESSING" },
  { from: "GAP_ANALYSIS", event: "MARK_ANALYSIS_COMPLETE", to: "GAP_RESOLUTION_REQUIRED" },
  { from: "GAP_RESOLUTION_REQUIRED", event: "ADD_EVIDENCE", to: "EVIDENCE_PROCESSING" },
  { from: "GAP_RESOLUTION_REQUIRED", event: "MARK_UNKNOWN", to: "GAP_RESOLUTION_REQUIRED" },
  { from: "GAP_RESOLUTION_REQUIRED", event: "CONTINUE_WITH_GAPS", to: "PHASE1_READY" },
  { from: "PHASE1_READY", event: "GENERATE_PHASE1", to: "PHASE1_ANALYSING" },
  { from: "PHASE1_ANALYSING", event: "MARK_ANALYSIS_COMPLETE", to: "PHASE1_AWAITING_REVIEW" },
  { from: "PHASE1_AWAITING_REVIEW", event: "APPROVE_PHASE1", to: "PHASE1_APPROVED" },
  { from: "PHASE1_AWAITING_REVIEW", event: "REQUEST_REVISION", to: "REVISION_REQUIRED" },
  { from: "PHASE1_AWAITING_REVIEW", event: "REJECT_PHASE1", to: "REVISION_REQUIRED" },
  { from: "PHASE1_AWAITING_REVIEW", event: "ADD_EVIDENCE", to: "EVIDENCE_PROCESSING" },
  { from: "REVISION_REQUIRED", event: "GENERATE_PHASE1", to: "PHASE1_ANALYSING" },
  { from: "REVISION_REQUIRED", event: "ADD_EVIDENCE", to: "EVIDENCE_PROCESSING" },
] as const;

/** States from which ordinary (unprompted) Add Information is accepted. */
export const addInformationStates: readonly WorkflowState[] = [
  "EVIDENCE_READY", "GAP_RESOLUTION_REQUIRED",
];

export function acceptsAddInformation(state: string | undefined): boolean {
  return addInformationStates.includes(state as WorkflowState);
}

export const humanOnlyEvents =new Set<WorkflowEvent>([
  "START_INTAKE", "SUBMIT_INTAKE", "ADD_EVIDENCE", "MARK_UNKNOWN",
  "CONTINUE_WITH_GAPS", "GENERATE_PHASE1", "APPROVE_PHASE1",
  "REQUEST_REVISION", "REJECT_PHASE1",
]);
export const systemOnlyEvents = new Set<WorkflowEvent>([
  "PROCESS_EVIDENCE", "RUN_GAP_ANALYSIS", "MARK_ANALYSIS_COMPLETE",
]);

export function resolveTransition(
  state: WorkflowState,
  event: WorkflowEvent,
  actor: ActorType,
): WorkflowState {
  if (humanOnlyEvents.has(event) && actor !== "human") {
    throw new Error(`${event} requires a human actor`);
  }
  if (systemOnlyEvents.has(event) && actor !== "system") {
    throw new Error(`${event} requires a system actor`);
  }
  const rule = transitionRules.find((item) => item.from === state && item.event === event);
  if (!rule) throw new Error(`Invalid workflow transition: ${state} + ${event}`);
  return rule.to;
}

export function authorizeWorkflowTransition(input: {
  businessId: string;
  workflowId: string;
  expectedVersion: number;
  currentState: WorkflowState;
  event: WorkflowEvent;
  actorType: ActorType;
  actorId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
}): AuthorizedWorkflowTransition {
  const command = Object.freeze({
    businessId: input.businessId,
    workflowId: input.workflowId,
    expectedVersion: input.expectedVersion,
    fromState: input.currentState,
    toState: resolveTransition(input.currentState, input.event, input.actorType),
    event: input.event,
    actorType: input.actorType,
    actorId: input.actorId,
    reason: input.reason,
    metadata: Object.freeze({ ...input.metadata }),
  });
  authorizedTransitions.add(command);
  return command;
}

export function assertAuthorizedWorkflowTransition(
  command: AuthorizedWorkflowTransition,
): void {
  if (!authorizedTransitions.has(command)) {
    throw new Error("Workflow mutation requires an Orchestrator-authorized transition");
  }
}
