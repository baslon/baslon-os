import { and, asc, desc, eq, inArray, lte, max } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  analysisRuns,
  approvedDiagnoses,
  businesses,
  businessStateSnapshots,
  diagnosisCalculations,
  diagnosisCalculationSources,
  diagnosisItemReferences,
  diagnosisItemReviews,
  diagnosisItems,
  diagnosisReviewSessions,
  evidenceGaps,
  strategyWorkflows,
  workflowTransitions,
} from "@/db/schema";
import { EVIDENCE_COHERENCE_MODULE } from "@/domain/evidence-coherence";
import {
  PHASE1_DIAGNOSIS_MODULE,
  type CarriedForwardGap,
  type DiagnosisCalculation,
  type DiagnosisReviewDecision,
} from "@/domain/phase1-diagnosis";
import type { ResolvedDiagnosisItem } from "@/domain/phase1-diagnosis-validation";
import type { Phase1DiagnosisModelInput } from "@/domain/phase1-diagnosis-projection";
import {
  assertActiveBusinessForUpdate,
  assertBusinessActive,
} from "@/repositories/business-lifecycle-guard";
import { latestApprovedHeadlineSet } from "@/repositories/diagnosis-headline-repository";

/**
 * Approval accepts a diagnosis as the analytical basis for the next phase, so
 * at least one item must survive review. An all-rejected review is sent back
 * with Request Revision instead.
 */
export class AllRejectedDiagnosisError extends Error {
  constructor() {
    super("An all-rejected diagnosis cannot be approved. Request a revised diagnosis instead.");
    this.name = "AllRejectedDiagnosisError";
  }
}

export type DiagnosisRunIdentity = {
  businessId: string;
  inputSnapshotId: string;
  module: string;
  inputProjectionVersion: string;
  promptVersion: string;
};

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const referenceColumn = {
  claim: "claimId",
  evidence: "evidenceId",
  metric: "metricId",
  gap: "evidenceGapId",
  calculation: "diagnosisCalculationId",
} as const;

/**
 * Persistence for Phase 1 Diagnosis. Every `analysis_runs` lookup is scoped to
 * the `phase1_diagnosis` module, and every strategic write locks the active
 * Business row first.
 */
export class Phase1DiagnosisRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async getBusiness(businessId: string) {
    const [business] = await this.database.select().from(businesses).where(eq(businesses.id, businessId));
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

  /** The snapshot and Evidence Coherence run the human last continued with. */
  async getContinuationBasis(businessId: string) {
    const workflow = await this.getWorkflow(businessId);
    if (!workflow) return undefined;
    const [transition] = await this.database.select({ metadata: workflowTransitions.metadata })
      .from(workflowTransitions).where(and(
        eq(workflowTransitions.workflowId, workflow.id),
        eq(workflowTransitions.event, "CONTINUE_WITH_GAPS"),
      )).orderBy(desc(workflowTransitions.createdAt)).limit(1);
    const snapshotId = transition?.metadata.snapshotId;
    const analysisRunId = transition?.metadata.analysisRunId;
    return typeof snapshotId === "string" && typeof analysisRunId === "string"
      ? { snapshotId, analysisRunId }
      : undefined;
  }

  /** Validated gaps of one successful same-Business Evidence Coherence run. */
  async getCarriedForwardGaps(coherenceRunId: string, businessId: string): Promise<CarriedForwardGap[]> {
    const [run] = await this.database.select({ id: analysisRuns.id }).from(analysisRuns).where(and(
      eq(analysisRuns.id, coherenceRunId),
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, EVIDENCE_COHERENCE_MODULE),
      eq(analysisRuns.status, "SUCCEEDED"),
    ));
    if (!run) throw new Error("The continued-with Evidence Coherence run was not found");
    const rows = await this.database.select().from(evidenceGaps).where(and(
      eq(evidenceGaps.analysisRunId, coherenceRunId),
      eq(evidenceGaps.businessId, businessId),
    )).orderBy(asc(evidenceGaps.priorityRank), asc(evidenceGaps.id));
    return rows.map((row) => ({
      id: row.id,
      analysisRunId: row.analysisRunId,
      area: row.area,
      missingInformation: row.missingInformation,
      decisionImpact: row.decisionImpact,
      materiality: row.materiality,
      priorityRank: row.priorityRank,
    }));
  }

  async findEquivalentActive(identity: DiagnosisRunIdentity) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.businessId, identity.businessId),
      eq(analysisRuns.inputSnapshotId, identity.inputSnapshotId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
      eq(analysisRuns.inputProjectionVersion, identity.inputProjectionVersion),
      eq(analysisRuns.promptVersion, identity.promptVersion),
      inArray(analysisRuns.status, ["RUNNING", "SUCCEEDED"]),
    )).orderBy(desc(analysisRuns.createdAt)).limit(1);
    return run;
  }

  /**
   * Creates the RUNNING run and persists its deterministic calculations and
   * their explicit sources in one transaction, before any model call.
   */
  async createRun(input: DiagnosisRunIdentity & {
    runType: string;
    inputPayload: Phase1DiagnosisModelInput;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    modelConfiguration: Record<string, unknown>;
    calculations: DiagnosisCalculation[];
  }) {
    try {
      return await this.database.transaction(async (tx) => {
        await assertActiveBusinessForUpdate(tx, input.businessId);
        const { calculations, ...runValues } = input;
        const [run] = await tx.insert(analysisRuns).values(runValues).returning();
        const rows = [];
        for (const calculation of calculations) {
          const [row] = await tx.insert(diagnosisCalculations).values({
            businessId: input.businessId,
            analysisRunId: run.id,
            calculationRef: calculation.handle,
            ruleKey: calculation.ruleKey,
            ruleVersion: calculation.ruleVersion,
            label: calculation.label,
            formula: calculation.formula,
            valueNumeric: calculation.valueNumeric,
            valuePrecision: calculation.valuePrecision,
            valueLower: calculation.valueLower,
            valueUpper: calculation.valueUpper,
            unit: calculation.unit,
          }).returning();
          await tx.insert(diagnosisCalculationSources).values(calculation.sources.map((source) => ({
            businessId: input.businessId,
            diagnosisCalculationId: row.id,
            metricId: source.entityType === "metric" ? source.id : null,
            evidenceId: source.entityType === "evidence" ? source.id : null,
          })));
          rows.push(row);
        }
        return { run, calculations: rows, created: true as const };
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const existing = await this.findEquivalentActive(input);
      if (!existing) throw error;
      return { run: existing, calculations: await this.getCalculations(existing.id, input.businessId), created: false as const };
    }
  }

  async getCalculations(runId: string, businessId: string) {
    return this.database.select().from(diagnosisCalculations).where(and(
      eq(diagnosisCalculations.analysisRunId, runId),
      eq(diagnosisCalculations.businessId, businessId),
    )).orderBy(asc(diagnosisCalculations.calculationRef));
  }

  async getCalculationSources(calculationIds: string[], businessId: string) {
    if (!calculationIds.length) return [];
    return this.database.select().from(diagnosisCalculationSources).where(and(
      inArray(diagnosisCalculationSources.diagnosisCalculationId, calculationIds),
      eq(diagnosisCalculationSources.businessId, businessId),
    ));
  }

  async failRun(input: { runId: string; businessId: string; rawModelOutput: unknown; validationErrors: unknown[] }) {
    const [run] = await this.database.update(analysisRuns).set({
      status: "FAILED",
      rawModelOutput: input.rawModelOutput,
      validationErrors: input.validationErrors,
      completedAt: new Date(),
    }).where(and(
      eq(analysisRuns.id, input.runId),
      eq(analysisRuns.businessId, input.businessId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
      eq(analysisRuns.status, "RUNNING"),
    )).returning();
    if (!run) throw new Error("Phase 1 Diagnosis run is not active");
    return run;
  }

  /** Conditional, same-Business recovery of an abandoned RUNNING run (AGENTS §19). */
  async failStaleRun(input: { runId: string; businessId: string; staleBefore: Date; validationErrors: unknown[] }) {
    const [run] = await this.database.update(analysisRuns).set({
      status: "FAILED",
      validationErrors: input.validationErrors,
      completedAt: new Date(),
    }).where(and(
      eq(analysisRuns.id, input.runId),
      eq(analysisRuns.businessId, input.businessId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
      eq(analysisRuns.status, "RUNNING"),
      lte(analysisRuns.startedAt, input.staleBefore),
    )).returning();
    return run;
  }

  /** Persists validated items and references and marks the run SUCCEEDED, atomically. */
  async completeRun(input: {
    runId: string;
    businessId: string;
    rawModelOutput: unknown;
    items: ResolvedDiagnosisItem[];
  }) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, input.businessId);
      const structured = [];
      for (const [index, item] of input.items.entries()) {
        const itemRef = `I${String(index + 1).padStart(3, "0")}`;
        const [row] = await tx.insert(diagnosisItems).values({
          businessId: input.businessId,
          analysisRunId: input.runId,
          itemRef,
          itemType: item.itemType,
          statement: item.statement,
          rationale: item.rationale,
          grounding: item.grounding,
          materiality: item.materiality,
          interpretationConfidence: item.interpretationConfidence,
          limitations: item.limitations,
          // v2 only; a v1 item has no headline and the 0008 trigger requires null there.
          headline: item.headline ?? null,
        }).returning();
        if (item.references.length) {
          await tx.insert(diagnosisItemReferences).values(item.references.map((reference) => ({
            businessId: input.businessId,
            analysisRunId: input.runId,
            diagnosisItemId: row.id,
            role: reference.role,
            [referenceColumn[reference.entityType]]: reference.id,
          })));
        }
        structured.push({
          itemRef,
          ...item,
          references: item.references.map(({ entityType, id, role }) => ({ entityType, id, role })),
        });
      }
      const [run] = await tx.update(analysisRuns).set({
        status: "SUCCEEDED",
        rawModelOutput: input.rawModelOutput,
        structuredOutput: { items: structured },
        validationErrors: [],
        completedAt: new Date(),
      }).where(and(
        eq(analysisRuns.id, input.runId),
        eq(analysisRuns.businessId, input.businessId),
        eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
        eq(analysisRuns.status, "RUNNING"),
      )).returning();
      if (!run) throw new Error("Phase 1 Diagnosis run is not active");
      return run;
    });
  }

  async getRun(runId: string, businessId: string) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.id, runId),
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
    ));
    return run;
  }

  async getLatestRunForSnapshot(snapshotId: string, businessId: string) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.inputSnapshotId, snapshotId),
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
    )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(1);
    return run;
  }

  async getItems(runId: string, businessId: string, database: Pick<Database, "select"> = this.database) {
    const items = await database.select().from(diagnosisItems).where(and(
      eq(diagnosisItems.analysisRunId, runId),
      eq(diagnosisItems.businessId, businessId),
    )).orderBy(asc(diagnosisItems.itemRef));
    const references = items.length
      ? await database.select().from(diagnosisItemReferences).where(and(
        eq(diagnosisItemReferences.analysisRunId, runId),
        eq(diagnosisItemReferences.businessId, businessId),
      ))
      : [];
    return items.map((item) => ({
      ...item,
      references: references.filter((reference) => reference.diagnosisItemId === item.id),
    }));
  }

  async getReviewSessionById(sessionId: string, businessId: string) {
    const [session] = await this.database.select().from(diagnosisReviewSessions).where(and(
      eq(diagnosisReviewSessions.id, sessionId),
      eq(diagnosisReviewSessions.businessId, businessId),
    ));
    return session;
  }

  async getReviewSession(runId: string, businessId: string) {
    const [session] = await this.database.select().from(diagnosisReviewSessions).where(and(
      eq(diagnosisReviewSessions.analysisRunId, runId),
      eq(diagnosisReviewSessions.businessId, businessId),
    ));
    return session;
  }

  async getItemReviews(sessionId: string, businessId: string) {
    return this.database.select().from(diagnosisItemReviews).where(and(
      eq(diagnosisItemReviews.reviewSessionId, sessionId),
      eq(diagnosisItemReviews.businessId, businessId),
    ));
  }

  async getApprovedDiagnosis(runId: string, businessId: string) {
    const [approved] = await this.database.select().from(approvedDiagnoses).where(and(
      eq(approvedDiagnoses.analysisRunId, runId),
      eq(approvedDiagnoses.businessId, businessId),
    ));
    return approved;
  }

  /**
   * The current companion headline set of one approved diagnosis, if any.
   * Read-only, for approved-diagnosis rendering; headlines are never generated here.
   */
  getLatestApprovedHeadlineSet(approvedDiagnosisId: string, businessId: string) {
    return latestApprovedHeadlineSet(this.database, approvedDiagnosisId, businessId);
  }

  /** Locks the Business and re-checks the review is for the current run in review. */
  private async lockReviewableRun(tx: Tx, businessId: string, runId: string) {
    await assertActiveBusinessForUpdate(tx, businessId);
    const [workflow] = await tx.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId)).for("update");
    if (workflow?.state !== "PHASE1_AWAITING_REVIEW") {
      throw new Error("Diagnosis review requires the workflow to be PHASE1_AWAITING_REVIEW");
    }
    const [latestSnapshot] = await tx.select({ id: businessStateSnapshots.id }).from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, businessId))
      .orderBy(desc(businessStateSnapshots.version)).limit(1);
    const [latestRun] = await tx.select().from(analysisRuns).where(and(
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, PHASE1_DIAGNOSIS_MODULE),
      eq(analysisRuns.status, "SUCCEEDED"),
    )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(1);
    if (!latestRun || latestRun.id !== runId || latestRun.inputSnapshotId !== latestSnapshot?.id) {
      throw new Error("Only the current diagnosis of the latest snapshot can be reviewed");
    }
    return latestRun;
  }

  async startReviewSession(input: { businessId: string; runId: string; reviewerId: string }) {
    return this.database.transaction(async (tx) => {
      await this.lockReviewableRun(tx, input.businessId, input.runId);
      const [existing] = await tx.select().from(diagnosisReviewSessions).where(and(
        eq(diagnosisReviewSessions.analysisRunId, input.runId),
        eq(diagnosisReviewSessions.businessId, input.businessId),
      ));
      if (existing) {
        if (existing.reviewerId !== input.reviewerId) {
          throw new Error("This diagnosis is already being reviewed by another reviewer");
        }
        return existing;
      }
      const [session] = await tx.insert(diagnosisReviewSessions).values({
        businessId: input.businessId,
        analysisRunId: input.runId,
        reviewerId: input.reviewerId,
      }).returning();
      return session;
    });
  }

  async recordItemDecision(input: {
    businessId: string;
    reviewSessionId: string;
    reviewerId: string;
    diagnosisItemId: string;
    decision: DiagnosisReviewDecision;
    correctedPayload: Record<string, unknown> | null;
    reason: string | null;
  }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(diagnosisReviewSessions).where(and(
        eq(diagnosisReviewSessions.id, input.reviewSessionId),
        eq(diagnosisReviewSessions.businessId, input.businessId),
      ));
      if (!session) throw new Error("Diagnosis review session not found");
      await this.lockReviewableRun(tx, input.businessId, session.analysisRunId);
      const [locked] = await tx.select().from(diagnosisReviewSessions)
        .where(eq(diagnosisReviewSessions.id, session.id)).for("update");
      if (locked.status !== "OPEN") throw new Error("This diagnosis review is already complete");
      if (locked.reviewerId !== input.reviewerId) throw new Error("Reviewer does not match the review session");
      const [item] = await tx.select().from(diagnosisItems).where(and(
        eq(diagnosisItems.id, input.diagnosisItemId),
        eq(diagnosisItems.businessId, input.businessId),
        eq(diagnosisItems.analysisRunId, session.analysisRunId),
      ));
      if (!item) throw new Error("Diagnosis item not found in this run");
      const [existing] = await tx.select().from(diagnosisItemReviews)
        .where(eq(diagnosisItemReviews.diagnosisItemId, item.id));
      if (existing) throw new Error("This diagnosis item already has a decision");
      const [review] = await tx.insert(diagnosisItemReviews).values({
        businessId: input.businessId,
        analysisRunId: session.analysisRunId,
        reviewSessionId: session.id,
        diagnosisItemId: item.id,
        decision: input.decision,
        correctedPayload: input.correctedPayload,
        reason: input.reason,
      }).returning();
      return review;
    });
  }

  /**
   * Completes the review and writes the immutable approved artifact in one
   * transaction. `buildArtifact` runs server-side over the locked, persisted
   * items, decisions and calculations; no client-supplied artifact is accepted.
   */
  async approve(input: {
    businessId: string;
    reviewSessionId: string;
    reviewerId: string;
    buildArtifact: (data: {
      run: typeof analysisRuns.$inferSelect;
      session: typeof diagnosisReviewSessions.$inferSelect;
      items: Awaited<ReturnType<Phase1DiagnosisRepository["getItems"]>>;
      reviews: Array<typeof diagnosisItemReviews.$inferSelect>;
      approvedAt: Date;
    }) => Promise<{ artifactVersion: string; content: Record<string, unknown> }>;
  }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(diagnosisReviewSessions).where(and(
        eq(diagnosisReviewSessions.id, input.reviewSessionId),
        eq(diagnosisReviewSessions.businessId, input.businessId),
      ));
      if (!session) throw new Error("Diagnosis review session not found");
      if (session.status === "COMPLETED") {
        const [approved] = await tx.select().from(approvedDiagnoses)
          .where(eq(approvedDiagnoses.reviewSessionId, session.id));
        return { approved, completedNow: false };
      }
      const run = await this.lockReviewableRun(tx, input.businessId, session.analysisRunId);
      const [locked] = await tx.select().from(diagnosisReviewSessions)
        .where(eq(diagnosisReviewSessions.id, session.id)).for("update");
      if (locked.reviewerId !== input.reviewerId) throw new Error("Reviewer does not match the review session");
      const items = await this.getItems(run.id, input.businessId, tx);
      const reviews = await tx.select().from(diagnosisItemReviews)
        .where(eq(diagnosisItemReviews.reviewSessionId, session.id));
      const decided = new Set(reviews.map((review) => review.diagnosisItemId));
      if (!items.length || items.some((item) => !decided.has(item.id)) || reviews.length !== items.length) {
        throw new Error("Every diagnosis item requires exactly one decision before approval");
      }
      if (!reviews.some((review) => review.decision === "ACCEPTED" || review.decision === "CORRECTED")) {
        throw new AllRejectedDiagnosisError();
      }
      const approvedAt = new Date();
      const artifact = await input.buildArtifact({ run, session: locked, items, reviews, approvedAt });
      const [completed] = await tx.update(diagnosisReviewSessions).set({ status: "COMPLETED", completedAt: approvedAt })
        .where(eq(diagnosisReviewSessions.id, session.id)).returning();
      const [latest] = await tx.select({ value: max(approvedDiagnoses.version) }).from(approvedDiagnoses)
        .where(eq(approvedDiagnoses.businessId, input.businessId));
      const snapshot = await tx.select({ version: businessStateSnapshots.version }).from(businessStateSnapshots)
        .where(eq(businessStateSnapshots.id, run.inputSnapshotId)).then((rows) => rows[0]);
      const [approved] = await tx.insert(approvedDiagnoses).values({
        businessId: input.businessId,
        analysisRunId: run.id,
        reviewSessionId: completed.id,
        snapshotId: run.inputSnapshotId,
        snapshotVersion: snapshot.version,
        inputProjectionVersion: run.inputProjectionVersion,
        promptVersion: run.promptVersion,
        inputHash: run.inputHash,
        artifactVersion: artifact.artifactVersion,
        version: (latest?.value ?? 0) + 1,
        approvedBy: input.reviewerId,
        approvedAt,
        approvedContent: artifact.content,
      }).returning();
      return { approved, completedNow: true };
    });
  }
}
