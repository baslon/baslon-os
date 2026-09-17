import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  analysisQuestions,
  analysisQuestionSources,
  analysisRuns,
  businessStateSnapshots,
  businesses,
  contradictions,
  evidenceGaps,
  evidenceExtractionRuns,
  sourceSubmissionAttachments,
  sourceSubmissions,
} from "@/db/schema";
import type {
  AnalysisQuestionContext,
  CreateQuestionAnswerSubmission,
  CreateSourceSubmission,
  CreateSourceSubmissionAttachment,
} from "@/domain/source-submission";
import {
  AnalysisQuestionAnswerError,
  SourceSubmissionOwnershipError,
} from "@/domain/source-submission";
import {
  assertBusinessActive,
  BusinessArchivedError,
} from "@/repositories/business-lifecycle-guard";

async function assertBusinessActiveForSourceWrite(
  database: Pick<Database, "select">,
  businessId: string,
) {
  const [business] = await database.select({ status: businesses.status }).from(businesses)
    .where(eq(businesses.id, businessId)).for("update");
  if (!business) throw new Error("Business not found");
  if (business.status !== "active") throw new BusinessArchivedError();
}

export class SourceSubmissionRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async create(input: CreateSourceSubmission) {
    return this.database.transaction(async (tx) => {
      await assertBusinessActiveForSourceWrite(tx, input.businessId);
      const [submission] = await tx.insert(sourceSubmissions).values(input).returning();
      return submission;
    });
  }

  private async resolveQuestionContext(
    database: Pick<Database, "select">,
    businessId: string,
    question: typeof analysisQuestions.$inferSelect,
  ): Promise<AnalysisQuestionContext> {
    const finding = question.contradictionId
      ? await database.select({ analysisRunId: contradictions.analysisRunId }).from(contradictions).where(and(
        eq(contradictions.id, question.contradictionId),
        eq(contradictions.businessId, businessId),
      )).then((rows) => rows[0])
      : await database.select({ analysisRunId: evidenceGaps.analysisRunId }).from(evidenceGaps).where(and(
        eq(evidenceGaps.id, question.evidenceGapId!),
        eq(evidenceGaps.businessId, businessId),
      )).then((rows) => rows[0]);
    if (!finding) throw new AnalysisQuestionAnswerError("Evidence Quality question not found.");
    const [run] = await database.select({
      id: analysisRuns.id,
      inputSnapshotId: analysisRuns.inputSnapshotId,
      module: analysisRuns.module,
      status: analysisRuns.status,
    }).from(analysisRuns).where(and(
      eq(analysisRuns.id, finding.analysisRunId),
      eq(analysisRuns.businessId, businessId),
    ));
    if (!run || run.module !== "evidence_coherence" || run.status !== "SUCCEEDED") {
      throw new AnalysisQuestionAnswerError("Evidence Quality analysis not found.");
    }
    return {
      kind: "analysis_question",
      questionId: question.id,
      questionText: question.question,
      analysisRunId: run.id,
      inputSnapshotId: run.inputSnapshotId,
    };
  }

  async createQuestionAnswer(input: CreateQuestionAnswerSubmission) {
    return this.database.transaction(async (tx) => {
      await assertBusinessActiveForSourceWrite(tx, input.businessId);
      const [question] = await tx.select().from(analysisQuestions).where(and(
        eq(analysisQuestions.id, input.questionId),
        eq(analysisQuestions.businessId, input.businessId),
      )).for("update");
      if (!question) throw new AnalysisQuestionAnswerError("Evidence Quality question not found.");
      const [existing] = await tx.select({ sourceSubmissionId: analysisQuestionSources.sourceSubmissionId })
        .from(analysisQuestionSources).where(and(
          eq(analysisQuestionSources.questionId, input.questionId),
          eq(analysisQuestionSources.businessId, input.businessId),
        ));
      if (existing) {
        throw new AnalysisQuestionAnswerError("This Evidence Quality question already has submitted information.");
      }
      const context = await this.resolveQuestionContext(tx, input.businessId, question);
      const [latestSnapshot] = await tx.select({ id: businessStateSnapshots.id })
        .from(businessStateSnapshots)
        .where(eq(businessStateSnapshots.businessId, input.businessId))
        .orderBy(desc(businessStateSnapshots.version)).limit(1);
      if (!latestSnapshot || latestSnapshot.id !== context.inputSnapshotId) {
        throw new AnalysisQuestionAnswerError("This Evidence Quality question belongs to a historical snapshot.");
      }
      const [source] = await tx.insert(sourceSubmissions).values({
        businessId: input.businessId,
        sourceType: input.sourceType,
        description: input.description,
        rawText: input.rawText,
        sourceReference: input.sourceReference,
        sourceOccurredAt: input.sourceOccurredAt,
      }).returning();
      await tx.insert(analysisQuestionSources).values({
        businessId: input.businessId,
        questionId: input.questionId,
        sourceSubmissionId: source.id,
      });
      return { source, context: { ...context, sourceSubmissionId: source.id } };
    });
  }

  async getQuestionContext(businessId: string, questionId: string) {
    const [question] = await this.database.select().from(analysisQuestions).where(and(
      eq(analysisQuestions.id, questionId),
      eq(analysisQuestions.businessId, businessId),
    ));
    if (!question) return undefined;
    const context = await this.resolveQuestionContext(this.database, businessId, question);
    const [link] = await this.database.select({ sourceSubmissionId: analysisQuestionSources.sourceSubmissionId })
      .from(analysisQuestionSources).where(and(
        eq(analysisQuestionSources.questionId, questionId),
        eq(analysisQuestionSources.businessId, businessId),
      ));
    return { ...context, sourceSubmissionId: link?.sourceSubmissionId };
  }

  async getQuestionContextForSource(businessId: string, sourceSubmissionId: string) {
    const [link] = await this.database.select({ questionId: analysisQuestionSources.questionId })
      .from(analysisQuestionSources).where(and(
        eq(analysisQuestionSources.sourceSubmissionId, sourceSubmissionId),
        eq(analysisQuestionSources.businessId, businessId),
      ));
    if (!link) return undefined;
    return this.getQuestionContext(businessId, link.questionId);
  }

  async getById(businessId: string, sourceSubmissionId: string) {
    const [submission] = await this.database.select().from(sourceSubmissions).where(and(
      eq(sourceSubmissions.id, sourceSubmissionId),
      eq(sourceSubmissions.businessId, businessId),
    ));
    return submission;
  }

  listForBusiness(businessId: string) {
    return this.database.select().from(sourceSubmissions)
      .where(eq(sourceSubmissions.businessId, businessId))
      .orderBy(sourceSubmissions.submittedAt, sourceSubmissions.id);
  }

  async createAttachment(input: CreateSourceSubmissionAttachment) {
    return this.database.transaction(async (tx) => {
      await assertBusinessActiveForSourceWrite(tx, input.businessId);
      const [submission] = await tx.select({ id: sourceSubmissions.id }).from(sourceSubmissions).where(and(
        eq(sourceSubmissions.id, input.sourceSubmissionId),
        eq(sourceSubmissions.businessId, input.businessId),
      ));
      if (!submission) throw new SourceSubmissionOwnershipError();
      const [attachment] = await tx.insert(sourceSubmissionAttachments).values(input).returning();
      return attachment;
    });
  }

  listAttachments(businessId: string, sourceSubmissionId: string) {
    return this.database.select().from(sourceSubmissionAttachments).where(and(
      eq(sourceSubmissionAttachments.businessId, businessId),
      eq(sourceSubmissionAttachments.sourceSubmissionId, sourceSubmissionId),
    )).orderBy(sourceSubmissionAttachments.createdAt, sourceSubmissionAttachments.id);
  }

  async getForExtractionRun(businessId: string, extractionRunId: string) {
    const [result] = await this.database.select({ submission: sourceSubmissions })
      .from(evidenceExtractionRuns)
      .innerJoin(sourceSubmissions, and(
        eq(sourceSubmissions.id, evidenceExtractionRuns.sourceSubmissionId),
        eq(sourceSubmissions.businessId, evidenceExtractionRuns.businessId),
      ))
      .where(and(
        eq(evidenceExtractionRuns.id, extractionRunId),
        eq(evidenceExtractionRuns.businessId, businessId),
      ));
    return result?.submission;
  }
}
