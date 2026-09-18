import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  analysisQuestions,
  analysisQuestionSources,
  analysisRuns,
  businessStateSnapshots,
  evidenceExtractionRuns,
  sourceSubmissions,
  strategyWorkflows,
} from "@/db/schema";
import type { AnalysisQuestionContext } from "@/domain/source-submission";
import { AnalysisQuestionAnswerError } from "@/domain/source-submission";
import { authorizeWorkflowTransition } from "@/domain/workflow";
import { assertActiveBusinessForUpdate } from "@/repositories/business-lifecycle-guard";
import type { ExtractionRunStart } from "@/repositories/evidence-extraction-repository";
import { resolveAnalysisQuestionContext } from "@/repositories/source-submission-repository";
import { persistAuthorizedWorkflowTransition } from "@/repositories/workflow-repository";

type AddInformationCommand = {
  businessId: string;
  rawText: string;
  sourceReference?: string;
  questionId?: string;
  expectedQuestionContext?: AnalysisQuestionContext;
  runStart: ExtractionRunStart;
};

export class AddInformationRepository {
  constructor(private readonly database: Database) {}

  async prepare(command: AddInformationCommand) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, command.businessId);
      const [workflow] = await tx.select().from(strategyWorkflows)
        .where(eq(strategyWorkflows.businessId, command.businessId))
        .for("update");
      if (!workflow) throw new Error("Workflow not found");

      const allowedStates = command.questionId
        ? ["GAP_RESOLUTION_REQUIRED"]
        : ["EVIDENCE_READY", "GAP_RESOLUTION_REQUIRED"];
      if (!allowedStates.includes(workflow.state)) {
        throw new Error(
          `Complete the current Evidence Review before adding information. Current workflow: ${workflow.state}`,
        );
      }

      let context: AnalysisQuestionContext | undefined;
      if (command.questionId) {
        const [question] = await tx.select().from(analysisQuestions).where(and(
          eq(analysisQuestions.id, command.questionId),
          eq(analysisQuestions.businessId, command.businessId),
        )).for("update");
        if (!question) throw new AnalysisQuestionAnswerError("Evidence Quality question not found.");
        const [existing] = await tx.select({ sourceSubmissionId: analysisQuestionSources.sourceSubmissionId })
          .from(analysisQuestionSources).where(and(
            eq(analysisQuestionSources.questionId, command.questionId),
            eq(analysisQuestionSources.businessId, command.businessId),
          ));
        if (existing) {
          throw new AnalysisQuestionAnswerError("This Evidence Quality question already has submitted information.");
        }
        context = await resolveAnalysisQuestionContext(tx, command.businessId, question);
        const [latestSnapshot] = await tx.select({ id: businessStateSnapshots.id })
          .from(businessStateSnapshots)
          .where(eq(businessStateSnapshots.businessId, command.businessId))
          .orderBy(desc(businessStateSnapshots.version)).limit(1);
        const [latestCoherenceRun] = await tx.select({ id: analysisRuns.id })
          .from(analysisRuns).where(and(
            eq(analysisRuns.businessId, command.businessId),
            eq(analysisRuns.module, "evidence_coherence"),
            eq(analysisRuns.status, "SUCCEEDED"),
          )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(1);
        if (
          !latestSnapshot
          || latestSnapshot.id !== context.inputSnapshotId
          || latestCoherenceRun?.id !== context.analysisRunId
          || command.expectedQuestionContext?.analysisRunId !== context.analysisRunId
          || command.expectedQuestionContext?.questionText !== context.questionText
        ) {
          throw new AnalysisQuestionAnswerError("This Evidence Quality question is not current.");
        }
      }

      const [source] = await tx.insert(sourceSubmissions).values({
        businessId: command.businessId,
        sourceType: "additional_text",
        rawText: command.rawText,
        sourceReference: command.sourceReference,
      }).returning();
      if (context) {
        await tx.insert(analysisQuestionSources).values({
          businessId: command.businessId,
          questionId: context.questionId,
          sourceSubmissionId: source.id,
        });
      }

      const transition = authorizeWorkflowTransition({
        businessId: command.businessId,
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        currentState: workflow.state,
        event: "ADD_EVIDENCE",
        actorType: "human",
        actorId: "business-user",
        metadata: {
          sourceSubmissionId: source.id,
          ...(context ? { analysisQuestionId: context.questionId } : {}),
        },
      });
      await persistAuthorizedWorkflowTransition(tx, transition);

      const sourceMetadata = context
        ? {
          ...command.runStart.sourceMetadata,
          interpretiveContext: {
            kind: context.kind,
            questionId: context.questionId,
            questionText: context.questionText,
          },
        }
        : command.runStart.sourceMetadata;
      const [run] = await tx.insert(evidenceExtractionRuns).values({
        ...command.runStart,
        businessId: command.businessId,
        sourceSubmissionId: source.id,
        rawIntakeText: command.rawText,
        sourceType: "additional_text",
        sourceReference: command.sourceReference,
        sourceMetadata,
      }).returning();
      return {
        source,
        context: context ? { ...context, sourceSubmissionId: source.id } : undefined,
        run,
      };
    });
  }
}
