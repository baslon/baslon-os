import {
  type AuthorizedWorkflowTransition,
  authorizeWorkflowTransition,
  transitionInputSchema,
} from "@/domain/workflow";

export interface WorkflowPersistence {
  assertBusinessActive(businessId: string): Promise<void>;
  getWorkflow(businessId: string): Promise<{
    id: string;
    businessId: string;
    state: AuthorizedWorkflowTransition["fromState"];
    version: number;
  } | undefined>;
  commit(command: AuthorizedWorkflowTransition): Promise<unknown>;
}

export class StrategyOrchestrator {
  constructor(private readonly repository: WorkflowPersistence) {}

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
    return this.repository.commit(command);
  }
}
