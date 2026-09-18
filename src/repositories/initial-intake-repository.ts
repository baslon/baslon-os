import { desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { evidenceExtractionRuns, strategyWorkflows } from "@/db/schema";
import { staleRunCutoff, staleRunValidationErrors } from "@/domain/ai-run-recovery";
import {
  initialIntakeAvailability,
  InitialIntakeUnavailableError,
  type InitialIntakeAvailability,
} from "@/domain/initial-intake";
import { authorizeWorkflowTransition, type WorkflowEvent } from "@/domain/workflow";
import { assertActiveBusinessForUpdate } from "@/repositories/business-lifecycle-guard";
import {
  failStaleExtractionRun,
  type ExtractionRunStart,
} from "@/repositories/evidence-extraction-repository";
import { persistAuthorizedWorkflowTransition } from "@/repositories/workflow-repository";

const intakeTransitions: Partial<Record<string, {
  event: WorkflowEvent;
  actorType: "human" | "system";
  actorId: string;
}>> = {
  NEW: { event: "START_INTAKE", actorType: "human", actorId: "business-user" },
  INTAKE_IN_PROGRESS: { event: "SUBMIT_INTAKE", actorType: "human", actorId: "business-user" },
  INTAKE_READY: {
    event: "PROCESS_EVIDENCE",
    actorType: "system",
    actorId: "evidence-extraction-service",
  },
};

function latestRun(database: Pick<Database, "select">, businessId: string) {
  return database.select().from(evidenceExtractionRuns)
    .where(eq(evidenceExtractionRuns.businessId, businessId))
    .orderBy(desc(evidenceExtractionRuns.createdAt), desc(evidenceExtractionRuns.id))
    .limit(1)
    .then((rows) => rows[0]);
}

export class InitialIntakeRepository {
  constructor(private readonly database: Database) {}

  /** Read-only availability for presentation; `prepare` re-decides under lock. */
  async getAvailability(businessId: string): Promise<InitialIntakeAvailability> {
    const [workflow] = await this.database.select({ state: strategyWorkflows.state })
      .from(strategyWorkflows).where(eq(strategyWorkflows.businessId, businessId));
    if (!workflow) return { kind: "unavailable" };
    return initialIntakeAvailability({
      workflowState: workflow.state,
      latestRun: await latestRun(this.database, businessId),
    });
  }

  /**
   * Atomically advances the intake workflow to EVIDENCE_PROCESSING and creates
   * the RUNNING extraction run. The model call must happen after this commits.
   */
  async prepare(command: { businessId: string; runStart: ExtractionRunStart }) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, command.businessId);
      let [workflow] = await tx.select().from(strategyWorkflows)
        .where(eq(strategyWorkflows.businessId, command.businessId))
        .for("update");
      if (!workflow) throw new Error("Workflow not found");

      const latest = await latestRun(tx, command.businessId);
      const availability = initialIntakeAvailability({
        workflowState: workflow.state,
        latestRun: latest,
      });
      if (availability.kind !== "available") {
        throw new InitialIntakeUnavailableError(availability);
      }
      if (availability.staleRunId) {
        const recovered = await failStaleExtractionRun(tx, {
          runId: availability.staleRunId,
          businessId: command.businessId,
          staleBefore: staleRunCutoff(),
          validationErrors: staleRunValidationErrors,
        });
        if (!recovered) throw new Error("The abandoned intake analysis could not be recovered");
      }

      let transition = intakeTransitions[workflow.state];
      while (transition) {
        workflow = await persistAuthorizedWorkflowTransition(tx, authorizeWorkflowTransition({
          businessId: command.businessId,
          workflowId: workflow.id,
          expectedVersion: workflow.version,
          currentState: workflow.state,
          event: transition.event,
          actorType: transition.actorType,
          actorId: transition.actorId,
          metadata: {},
        }));
        transition = intakeTransitions[workflow.state];
      }
      if (workflow.state !== "EVIDENCE_PROCESSING") {
        throw new Error(`Cannot run intake extraction while workflow is ${workflow.state}`);
      }

      const [run] = await tx.insert(evidenceExtractionRuns).values({
        ...command.runStart,
        businessId: command.businessId,
        sourceSubmissionId: undefined,
      }).returning();
      return run;
    });
  }
}
