import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { strategyWorkflows, workflowTransitions } from "@/db/schema";
import {
  authorizeWorkflowTransition,
  assertAuthorizedWorkflowTransition,
  type AuthorizedWorkflowTransition,
} from "@/domain/workflow";
import {
  StrategyOrchestrator,
  type WorkflowPersistence,
  type WorkflowTransitionPrecondition,
  type WorkflowTransitionPreconditions,
} from "@/strategy/orchestrator";
import {
  assertActiveBusinessForUpdate,
  assertBusinessActive,
} from "@/repositories/business-lifecycle-guard";
import { defaultWorkflowTransitionPreconditions } from "@/repositories/workflow-preconditions";

class PostgresWorkflowRepository implements WorkflowPersistence {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async getWorkflow(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow;
  }

  async commit(
    command: AuthorizedWorkflowTransition,
    precondition?: WorkflowTransitionPrecondition,
  ) {
    assertAuthorizedWorkflowTransition(command);
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, command.businessId);
      const [workflow] = await tx.select().from(strategyWorkflows).where(and(
        eq(strategyWorkflows.id, command.workflowId),
        eq(strategyWorkflows.businessId, command.businessId),
      )).for("update");
      if (
        !workflow
        || workflow.version !== command.expectedVersion
        || workflow.state !== command.fromState
      ) {
        throw new Error("Workflow changed concurrently");
      }
      const authorized = authorizeWorkflowTransition({
        businessId: command.businessId,
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        currentState: workflow.state,
        event: command.event,
        actorType: command.actorType,
        actorId: command.actorId,
        reason: command.reason,
        metadata: command.metadata,
      });
      await precondition?.({
        businessId: command.businessId,
        event: command.event,
        actorType: command.actorType,
        workflow,
        metadata: command.metadata,
        database: tx,
      });
      return persistAuthorizedWorkflowTransition(tx, authorized);
    });
  }
}

export async function persistAuthorizedWorkflowTransition(
  database: Pick<Database, "update" | "insert">,
  command: AuthorizedWorkflowTransition,
) {
  assertAuthorizedWorkflowTransition(command);
  const [updated] = await database.update(strategyWorkflows).set({
    state: command.toState,
    version: command.expectedVersion + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(strategyWorkflows.id, command.workflowId),
    eq(strategyWorkflows.version, command.expectedVersion),
    eq(strategyWorkflows.state, command.fromState),
  )).returning();
  if (!updated) throw new Error("Workflow changed concurrently");
  await database.insert(workflowTransitions).values({
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
}

export function createStrategyOrchestrator(
  database: Database,
  preconditions: WorkflowTransitionPreconditions = {},
) {
  return new StrategyOrchestrator(new PostgresWorkflowRepository(database), {
    ...defaultWorkflowTransitionPreconditions,
    ...preconditions,
  });
}
