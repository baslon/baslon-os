import {
  type AuthorizedWorkflowTransition,
  type WorkflowEvent,
  authorizeWorkflowTransition,
  transitionInputSchema,
} from "@/domain/workflow";
import type { Database } from "@/db/client";

export type WorkflowTransitionContext = {
  businessId: string;
  event: WorkflowEvent;
  actorType: AuthorizedWorkflowTransition["actorType"];
  workflow: Awaited<ReturnType<WorkflowPersistence["getWorkflow"]>> & {};
  metadata: Record<string, unknown>;
  database: Pick<Database, "select">;
};

export type WorkflowTransitionPrecondition = (
  context: WorkflowTransitionContext,
) => Promise<void> | void;

export type WorkflowTransitionPreconditions = Partial<
  Record<WorkflowEvent, WorkflowTransitionPrecondition>
>;

export interface WorkflowPersistence {
  assertBusinessActive(businessId: string): Promise<void>;
  getWorkflow(businessId: string): Promise<{
    id: string;
    businessId: string;
    state: AuthorizedWorkflowTransition["fromState"];
    version: number;
  } | undefined>;
  commit(
    command: AuthorizedWorkflowTransition,
    precondition?: WorkflowTransitionPrecondition,
  ): Promise<unknown>;
}

export class StrategyOrchestrator {
  constructor(
    private readonly repository: WorkflowPersistence,
    private readonly preconditions: WorkflowTransitionPreconditions = {},
  ) {}

  async transition(input: unknown) {
    const parsed = transitionInputSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const workflow = await this.repository.getWorkflow(parsed.businessId);
    if (!workflow) throw new Error("Workflow not found");
    const command = authorizeWorkflowTransition({
      ...parsed,
      workflowId: workflow.id,
      expectedVersion: workflow.version,
      currentState: workflow.state,
    });
    return this.repository.commit(command, this.preconditions[parsed.event]);
  }
}
