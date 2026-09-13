import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { strategyWorkflows, workflowTransitions } from "@/db/schema";
import {
  assertAuthorizedWorkflowTransition,
  type AuthorizedWorkflowTransition,
} from "@/domain/workflow";
import {
  StrategyOrchestrator,
  type WorkflowPersistence,
} from "@/strategy/orchestrator";

class PostgresWorkflowRepository implements WorkflowPersistence {
  constructor(private readonly database: Database) {}

  async getWorkflow(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow;
  }

  async commit(command: AuthorizedWorkflowTransition) {
    assertAuthorizedWorkflowTransition(command);
    return this.database.transaction(async (tx) => {
      const [updated] = await tx.update(strategyWorkflows).set({
        state: command.toState,
        version: command.expectedVersion + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(strategyWorkflows.id, command.workflowId),
        eq(strategyWorkflows.version, command.expectedVersion),
        eq(strategyWorkflows.state, command.fromState),
      )).returning();
      if (!updated) throw new Error("Workflow changed concurrently");
      await tx.insert(workflowTransitions).values({
        workflowId: command.workflowId,
        fromState: command.fromState,
        toState: command.toState,
        event: command.event,
        actorType: command.actorType,
        actorId: command.actorId,
        reason: command.reason,
        metadata: command.metadata,
      });
      return updated;
    });
  }
}

export function createStrategyOrchestrator(database: Database) {
  return new StrategyOrchestrator(new PostgresWorkflowRepository(database));
}
