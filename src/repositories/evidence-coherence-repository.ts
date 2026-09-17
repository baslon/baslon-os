import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  analysisFindingReferences,
  analysisQuestions,
  analysisQuestionSources,
  analysisRuns,
  businessStateSnapshots,
  businesses,
  contradictions,
  evidenceGaps,
  strategyWorkflows,
} from "@/db/schema";
import type { EvidenceCoherenceOutput } from "@/ai/evidence-coherence/contracts";
import type { EvidenceCoherenceModelInput } from "@/ai/evidence-coherence/contracts";
import { assertBusinessActive } from "@/repositories/business-lifecycle-guard";

export type AnalysisRunIdentity = {
  businessId: string;
  inputSnapshotId: string;
  module: string;
  inputProjectionVersion: string;
  promptVersion: string;
};

export class EvidenceCoherenceRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async getBusiness(businessId: string) {
    const [business] = await this.database.select().from(businesses)
      .where(eq(businesses.id, businessId));
    return business;
  }

  async getLatestSnapshot(businessId: string) {
    const [snapshot] = await this.database.select().from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, businessId))
      .orderBy(desc(businessStateSnapshots.version)).limit(1);
    return snapshot;
  }

  async getSnapshot(snapshotId: string, businessId: string) {
    const [snapshot] = await this.database.select().from(businessStateSnapshots).where(and(
      eq(businessStateSnapshots.id, snapshotId),
      eq(businessStateSnapshots.businessId, businessId),
    ));
    return snapshot;
  }

  async getWorkflow(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow;
  }

  async findEquivalentActive(identity: AnalysisRunIdentity) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.businessId, identity.businessId),
      eq(analysisRuns.inputSnapshotId, identity.inputSnapshotId),
      eq(analysisRuns.module, identity.module),
      eq(analysisRuns.inputProjectionVersion, identity.inputProjectionVersion),
      eq(analysisRuns.promptVersion, identity.promptVersion),
      inArray(analysisRuns.status, ["RUNNING", "SUCCEEDED"]),
    )).orderBy(desc(analysisRuns.createdAt)).limit(1);
    return run;
  }

  async createRun(input: AnalysisRunIdentity & {
    runType: string;
    inputPayload: EvidenceCoherenceModelInput;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    modelConfiguration: Record<string, unknown>;
  }) {
    try {
      const [run] = await this.database.insert(analysisRuns).values(input).returning();
      return { run, created: true as const };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const existing = await this.findEquivalentActive(input);
      if (!existing) throw error;
      return { run: existing, created: false as const };
    }
  }

  async failRun(input: {
    runId: string;
    businessId: string;
    rawModelOutput: unknown;
    validationErrors: unknown[];
  }) {
    const [run] = await this.database.update(analysisRuns).set({
      status: "FAILED",
      rawModelOutput: input.rawModelOutput,
      validationErrors: input.validationErrors,
      completedAt: new Date(),
    }).where(and(
      eq(analysisRuns.id, input.runId),
      eq(analysisRuns.businessId, input.businessId),
      eq(analysisRuns.status, "RUNNING"),
    )).returning();
    if (!run) throw new Error("Evidence Coherence run is not active");
    return run;
  }

  async completeRun(input: {
    runId: string;
    businessId: string;
    rawModelOutput: unknown;
    output: EvidenceCoherenceOutput;
  }) {
    return this.database.transaction(async (tx) => {
      const contradictionIds = new Map<string, string>();
      const gapIds = new Map<string, string>();
      if (input.output.contradictions.length) {
        const rows = await tx.insert(contradictions).values(input.output.contradictions.map((item) => ({
          businessId: input.businessId,
          analysisRunId: input.runId,
          area: item.area,
          statement: item.statement,
          rationale: item.rationale,
          materiality: item.materiality,
          priorityRank: item.priorityRank,
        }))).returning();
        rows.forEach((row, index) => contradictionIds.set(input.output.contradictions[index].findingRef, row.id));
      }
      if (input.output.gaps.length) {
        const rows = await tx.insert(evidenceGaps).values(input.output.gaps.map((item) => ({
          businessId: input.businessId,
          analysisRunId: input.runId,
          area: item.area,
          missingInformation: item.missingInformation,
          decisionImpact: item.decisionImpact,
          materiality: item.materiality,
          priorityRank: item.priorityRank,
        }))).returning();
        rows.forEach((row, index) => gapIds.set(input.output.gaps[index].findingRef, row.id));
      }

      const references = [
        ...input.output.contradictions.flatMap((finding) => finding.references.map((reference) => ({ findingType: "contradiction" as const, findingRef: finding.findingRef, reference }))),
        ...input.output.gaps.flatMap((finding) => finding.references.map((reference) => ({ findingType: "gap" as const, findingRef: finding.findingRef, reference }))),
      ];
      if (references.length) {
        await tx.insert(analysisFindingReferences).values(references.map(({ findingType, findingRef, reference }) => ({
          businessId: input.businessId,
          contradictionId: findingType === "contradiction" ? contradictionIds.get(findingRef) : undefined,
          evidenceGapId: findingType === "gap" ? gapIds.get(findingRef) : undefined,
          claimId: reference.recordType === "claim" ? reference.recordId : undefined,
          evidenceId: reference.recordType === "evidence" ? reference.recordId : undefined,
          metricId: reference.recordType === "metric" ? reference.recordId : undefined,
          role: reference.role,
        })));
      }
      if (input.output.questions.length) {
        await tx.insert(analysisQuestions).values(input.output.questions.map((question) => ({
          businessId: input.businessId,
          contradictionId: question.findingType === "contradiction"
            ? contradictionIds.get(question.findingRef) : undefined,
          evidenceGapId: question.findingType === "gap" ? gapIds.get(question.findingRef) : undefined,
          question: question.question,
          priorityOrder: question.priorityOrder,
        })));
      }
      const [run] = await tx.update(analysisRuns).set({
        status: "SUCCEEDED",
        rawModelOutput: input.rawModelOutput,
        structuredOutput: input.output,
        validationErrors: [],
        completedAt: new Date(),
      }).where(and(
        eq(analysisRuns.id, input.runId),
        eq(analysisRuns.businessId, input.businessId),
        eq(analysisRuns.status, "RUNNING"),
      )).returning();
      if (!run) throw new Error("Evidence Coherence run is not active");
      return run;
    });
  }

  async getRun(runId: string, businessId: string) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.id, runId), eq(analysisRuns.businessId, businessId),
    ));
    return run;
  }

  async getLatestRunForSnapshot(snapshotId: string, businessId: string) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.inputSnapshotId, snapshotId), eq(analysisRuns.businessId, businessId),
    )).orderBy(desc(analysisRuns.createdAt)).limit(1);
    return run;
  }

  async getLatestRunForBusiness(businessId: string) {
    const [run] = await this.database.select().from(analysisRuns)
      .where(eq(analysisRuns.businessId, businessId))
      .orderBy(desc(analysisRuns.createdAt)).limit(1);
    return run;
  }

  async getRunResult(runId: string, businessId: string) {
    const run = await this.getRun(runId, businessId);
    if (!run) return undefined;
    const [contradictionRows, gapRows, referenceRows] = await Promise.all([
      this.database.select().from(contradictions).where(and(
        eq(contradictions.analysisRunId, runId), eq(contradictions.businessId, businessId),
      )).orderBy(contradictions.priorityRank),
      this.database.select().from(evidenceGaps).where(and(
        eq(evidenceGaps.analysisRunId, runId), eq(evidenceGaps.businessId, businessId),
      )).orderBy(evidenceGaps.priorityRank),
      this.database.select().from(analysisFindingReferences)
        .where(eq(analysisFindingReferences.businessId, businessId)),
    ]);
    const contradictionIds = contradictionRows.map((item) => item.id);
    const gapIds = gapRows.map((item) => item.id);
    const questionWhere = [
      contradictionIds.length ? inArray(analysisQuestions.contradictionId, contradictionIds) : undefined,
      gapIds.length ? inArray(analysisQuestions.evidenceGapId, gapIds) : undefined,
    ].filter(Boolean);
    const questionRows = questionWhere.length
      ? await this.database.select().from(analysisQuestions).where(and(
        eq(analysisQuestions.businessId, businessId),
        or(...questionWhere as [NonNullable<(typeof questionWhere)[number]>, ...NonNullable<(typeof questionWhere)[number]>[]]),
      )).orderBy(analysisQuestions.priorityOrder)
      : [];
    const questionIds = questionRows.map((question) => question.id);
    const questionSources = questionIds.length
      ? await this.database.select().from(analysisQuestionSources).where(and(
        eq(analysisQuestionSources.businessId, businessId),
        inArray(analysisQuestionSources.questionId, questionIds),
      ))
      : [];
    return {
      run,
      contradictions: contradictionRows.map((item) => ({
        ...item,
        references: referenceRows.filter((ref) => ref.contradictionId === item.id),
      })),
      gaps: gapRows.map((item) => ({
        ...item,
        references: referenceRows.filter((ref) => ref.evidenceGapId === item.id),
      })),
      questions: questionRows.map((question) => ({
        ...question,
        sourceSubmissionId: questionSources.find((link) => link.questionId === question.id)?.sourceSubmissionId ?? null,
      })),
    };
  }
}
