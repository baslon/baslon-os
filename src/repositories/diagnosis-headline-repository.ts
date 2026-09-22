import { and, asc, desc, eq, lte, max, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  analysisRuns,
  approvedDiagnoses,
  approvedDiagnosisHeadlines,
  approvedDiagnosisHeadlineSets,
  businesses,
  diagnosisHeadlineProposals,
  diagnosisHeadlineReviews,
  diagnosisHeadlineReviewSessions,
  strategyWorkflows,
} from "@/db/schema";
import {
  DIAGNOSIS_HEADLINES_MODULE,
  effectiveHeadline,
  type DiagnosisHeadlineReviewDecision,
  type ValidatedHeadlineProposal,
} from "@/domain/diagnosis-headlines";
import {
  assertActiveBusinessForUpdate,
  assertBusinessActive,
} from "@/repositories/business-lifecycle-guard";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The current companion headline set of one approved diagnosis: its latest approved version. */
export async function latestApprovedHeadlineSet(
  database: Pick<Database, "select">,
  approvedDiagnosisId: string,
  businessId: string,
) {
  const [headlineSet] = await database.select().from(approvedDiagnosisHeadlineSets).where(and(
    eq(approvedDiagnosisHeadlineSets.approvedDiagnosisId, approvedDiagnosisId),
    eq(approvedDiagnosisHeadlineSets.businessId, businessId),
  )).orderBy(desc(approvedDiagnosisHeadlineSets.version)).limit(1);
  if (!headlineSet) return undefined;
  const headlines = await database.select().from(approvedDiagnosisHeadlines).where(and(
    eq(approvedDiagnosisHeadlines.headlineSetId, headlineSet.id),
    eq(approvedDiagnosisHeadlines.businessId, businessId),
  )).orderBy(asc(approvedDiagnosisHeadlines.itemRef));
  return { ...headlineSet, headlines };
}

/**
 * Persistence for companion diagnosis headlines. Every `analysis_runs` lookup
 * is scoped to the `diagnosis_headlines` module, every headline is bound to its
 * exact approved diagnosis and diagnosis run, and every write locks the active
 * Business row first. No write here touches the approved diagnosis, the
 * diagnosis review, canonical records or the workflow.
 */
export class DiagnosisHeadlineRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async getBusiness(businessId: string) {
    const [business] = await this.database.select().from(businesses).where(eq(businesses.id, businessId));
    return business;
  }

  async getWorkflow(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow;
  }

  /** The Business's current approved diagnosis: the highest approved version. */
  async getCurrentApprovedDiagnosis(businessId: string) {
    const [approved] = await this.database.select().from(approvedDiagnoses)
      .where(eq(approvedDiagnoses.businessId, businessId))
      .orderBy(desc(approvedDiagnoses.version)).limit(1);
    return approved;
  }

  /** Every headline proposal run of one approved diagnosis, newest first. */
  async getRuns(approvedDiagnosisId: string, businessId: string) {
    return this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, DIAGNOSIS_HEADLINES_MODULE),
      sql`${analysisRuns.modelConfiguration} ->> 'approvedDiagnosisId' = ${approvedDiagnosisId}`,
    )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id));
  }

  async getRun(runId: string, businessId: string) {
    const [run] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.id, runId),
      eq(analysisRuns.businessId, businessId),
      eq(analysisRuns.module, DIAGNOSIS_HEADLINES_MODULE),
    ));
    return run;
  }

  async createRun(input: {
    businessId: string;
    inputSnapshotId: string;
    inputProjectionVersion: string;
    promptVersion: string;
    runType: string;
    inputPayload: Record<string, unknown>;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    modelConfiguration: Record<string, unknown>;
  }) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, input.businessId);
      const [run] = await tx.insert(analysisRuns).values({ ...input, module: DIAGNOSIS_HEADLINES_MODULE }).returning();
      return run;
    });
  }

  /** Persists every validated proposal and marks the run SUCCEEDED, atomically. */
  async completeRun(input: {
    runId: string;
    businessId: string;
    approvedDiagnosisId: string;
    diagnosisRunId: string;
    rawModelOutput: unknown;
    proposals: ValidatedHeadlineProposal[];
  }) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, input.businessId);
      for (const proposal of input.proposals) {
        await tx.insert(diagnosisHeadlineProposals).values({
          businessId: input.businessId,
          analysisRunId: input.runId,
          approvedDiagnosisId: input.approvedDiagnosisId,
          diagnosisRunId: input.diagnosisRunId,
          diagnosisItemId: proposal.diagnosisItemId,
          itemRef: proposal.itemRef,
          headline: proposal.headline,
        });
      }
      const [run] = await tx.update(analysisRuns).set({
        status: "SUCCEEDED",
        rawModelOutput: input.rawModelOutput,
        structuredOutput: { headlines: input.proposals.map(({ itemRef, headline }) => ({ itemHandle: itemRef, headline })) },
        validationErrors: [],
        completedAt: new Date(),
      }).where(and(
        eq(analysisRuns.id, input.runId),
        eq(analysisRuns.businessId, input.businessId),
        eq(analysisRuns.module, DIAGNOSIS_HEADLINES_MODULE),
        eq(analysisRuns.status, "RUNNING"),
      )).returning();
      if (!run) throw new Error("Diagnosis headline run is not active");
      return run;
    });
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
      eq(analysisRuns.module, DIAGNOSIS_HEADLINES_MODULE),
      eq(analysisRuns.status, "RUNNING"),
    )).returning();
    if (!run) throw new Error("Diagnosis headline run is not active");
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
      eq(analysisRuns.module, DIAGNOSIS_HEADLINES_MODULE),
      eq(analysisRuns.status, "RUNNING"),
      lte(analysisRuns.startedAt, input.staleBefore),
    )).returning();
    return run;
  }

  async getProposals(runId: string, businessId: string, database: Pick<Database, "select"> = this.database) {
    return database.select().from(diagnosisHeadlineProposals).where(and(
      eq(diagnosisHeadlineProposals.analysisRunId, runId),
      eq(diagnosisHeadlineProposals.businessId, businessId),
    )).orderBy(asc(diagnosisHeadlineProposals.itemRef));
  }

  async getSession(sessionId: string, businessId: string) {
    const [session] = await this.database.select().from(diagnosisHeadlineReviewSessions).where(and(
      eq(diagnosisHeadlineReviewSessions.id, sessionId),
      eq(diagnosisHeadlineReviewSessions.businessId, businessId),
    ));
    return session;
  }

  async getOpenSession(approvedDiagnosisId: string, businessId: string) {
    const [session] = await this.database.select().from(diagnosisHeadlineReviewSessions).where(and(
      eq(diagnosisHeadlineReviewSessions.approvedDiagnosisId, approvedDiagnosisId),
      eq(diagnosisHeadlineReviewSessions.businessId, businessId),
      eq(diagnosisHeadlineReviewSessions.status, "OPEN"),
    ));
    return session;
  }

  async getReviews(sessionId: string, businessId: string, database: Pick<Database, "select"> = this.database) {
    return database.select().from(diagnosisHeadlineReviews).where(and(
      eq(diagnosisHeadlineReviews.reviewSessionId, sessionId),
      eq(diagnosisHeadlineReviews.businessId, businessId),
    ));
  }

  getLatestApprovedSet(approvedDiagnosisId: string, businessId: string) {
    return latestApprovedHeadlineSet(this.database, approvedDiagnosisId, businessId);
  }

  async getApprovedSets(approvedDiagnosisId: string, businessId: string) {
    return this.database.select().from(approvedDiagnosisHeadlineSets).where(and(
      eq(approvedDiagnosisHeadlineSets.approvedDiagnosisId, approvedDiagnosisId),
      eq(approvedDiagnosisHeadlineSets.businessId, businessId),
    )).orderBy(asc(approvedDiagnosisHeadlineSets.version));
  }

  /**
   * Locks the active Business and re-checks that this exact approved diagnosis
   * is still the Business's current approved Phase 1 Diagnosis. Headlines are a
   * presentation layer over that approval and never create a workflow transition.
   */
  private async lockApprovedDiagnosis(tx: Tx, businessId: string, approvedDiagnosisId: string) {
    await assertActiveBusinessForUpdate(tx, businessId);
    const [workflow] = await tx.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId)).for("update");
    if (workflow?.state !== "PHASE1_APPROVED") {
      throw new Error("Diagnosis headlines require the workflow to be PHASE1_APPROVED");
    }
    const [current] = await tx.select().from(approvedDiagnoses)
      .where(eq(approvedDiagnoses.businessId, businessId))
      .orderBy(desc(approvedDiagnoses.version)).limit(1);
    if (!current || current.id !== approvedDiagnosisId) {
      throw new Error("Headlines can only be written for the current approved diagnosis");
    }
    return current;
  }

  /** Starts a headline-only review of one successful proposal run, for the next set version. */
  async startReviewSession(input: {
    businessId: string;
    approvedDiagnosisId: string;
    proposalRunId: string;
    reviewerId: string;
  }) {
    return this.database.transaction(async (tx) => {
      const approved = await this.lockApprovedDiagnosis(tx, input.businessId, input.approvedDiagnosisId);
      const [existing] = await tx.select().from(diagnosisHeadlineReviewSessions).where(and(
        eq(diagnosisHeadlineReviewSessions.approvedDiagnosisId, input.approvedDiagnosisId),
        eq(diagnosisHeadlineReviewSessions.businessId, input.businessId),
        eq(diagnosisHeadlineReviewSessions.status, "OPEN"),
      ));
      if (existing) {
        if (existing.reviewerId !== input.reviewerId) {
          throw new Error("These headlines are already being reviewed by another reviewer");
        }
        if (existing.proposalRunId !== input.proposalRunId) {
          throw new Error("An open headline review already exists for a different proposal run");
        }
        return existing;
      }
      const [latest] = await tx.select({ value: max(approvedDiagnosisHeadlineSets.version) })
        .from(approvedDiagnosisHeadlineSets)
        .where(and(
          eq(approvedDiagnosisHeadlineSets.approvedDiagnosisId, input.approvedDiagnosisId),
          eq(approvedDiagnosisHeadlineSets.businessId, input.businessId),
        ));
      const [session] = await tx.insert(diagnosisHeadlineReviewSessions).values({
        businessId: input.businessId,
        approvedDiagnosisId: approved.id,
        diagnosisRunId: approved.analysisRunId,
        proposalRunId: input.proposalRunId,
        setVersion: (latest?.value ?? 0) + 1,
        reviewerId: input.reviewerId,
      }).returning();
      return session;
    });
  }

  /** Records one ACCEPTED or CORRECTED headline decision. There is no headline REJECT. */
  async recordDecision(input: {
    businessId: string;
    reviewSessionId: string;
    reviewerId: string;
    diagnosisItemId: string;
    decision: DiagnosisHeadlineReviewDecision;
    correctedHeadline: string | null;
    reason: string | null;
  }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(diagnosisHeadlineReviewSessions).where(and(
        eq(diagnosisHeadlineReviewSessions.id, input.reviewSessionId),
        eq(diagnosisHeadlineReviewSessions.businessId, input.businessId),
      ));
      if (!session) throw new Error("Headline review session not found");
      await this.lockApprovedDiagnosis(tx, input.businessId, session.approvedDiagnosisId);
      const [locked] = await tx.select().from(diagnosisHeadlineReviewSessions)
        .where(eq(diagnosisHeadlineReviewSessions.id, session.id)).for("update");
      if (locked.status !== "OPEN") throw new Error("This headline review is already complete");
      if (locked.reviewerId !== input.reviewerId) throw new Error("Reviewer does not match the headline review session");
      const [proposal] = await tx.select().from(diagnosisHeadlineProposals).where(and(
        eq(diagnosisHeadlineProposals.analysisRunId, session.proposalRunId),
        eq(diagnosisHeadlineProposals.businessId, input.businessId),
        eq(diagnosisHeadlineProposals.diagnosisItemId, input.diagnosisItemId),
      ));
      if (!proposal) throw new Error("No proposed headline for this diagnosis item");
      const [existing] = await tx.select().from(diagnosisHeadlineReviews).where(and(
        eq(diagnosisHeadlineReviews.reviewSessionId, session.id),
        eq(diagnosisHeadlineReviews.diagnosisItemId, input.diagnosisItemId),
      ));
      if (existing) throw new Error("This headline already has a decision");
      const [review] = await tx.insert(diagnosisHeadlineReviews).values({
        businessId: input.businessId,
        reviewSessionId: session.id,
        approvedDiagnosisId: session.approvedDiagnosisId,
        diagnosisRunId: session.diagnosisRunId,
        proposalRunId: session.proposalRunId,
        diagnosisItemId: input.diagnosisItemId,
        proposalId: proposal.id,
        decision: input.decision,
        correctedHeadline: input.correctedHeadline,
        reason: input.reason,
      }).returning();
      return review;
    });
  }

  /**
   * Human approval of one headline set: completes the review and writes the
   * immutable set and its headlines in one transaction. The final headlines are
   * derived server-side from the persisted proposals and decisions.
   */
  async approveSet(input: { businessId: string; reviewSessionId: string; reviewerId: string }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(diagnosisHeadlineReviewSessions).where(and(
        eq(diagnosisHeadlineReviewSessions.id, input.reviewSessionId),
        eq(diagnosisHeadlineReviewSessions.businessId, input.businessId),
      ));
      if (!session) throw new Error("Headline review session not found");
      if (session.status === "COMPLETED") {
        const [approvedSet] = await tx.select().from(approvedDiagnosisHeadlineSets)
          .where(eq(approvedDiagnosisHeadlineSets.reviewSessionId, session.id));
        return { headlineSet: approvedSet, approvedNow: false };
      }
      const approved = await this.lockApprovedDiagnosis(tx, input.businessId, session.approvedDiagnosisId);
      const [locked] = await tx.select().from(diagnosisHeadlineReviewSessions)
        .where(eq(diagnosisHeadlineReviewSessions.id, session.id)).for("update");
      if (locked.reviewerId !== input.reviewerId) throw new Error("Reviewer does not match the headline review session");
      const proposals = await this.getProposals(session.proposalRunId, input.businessId, tx);
      const reviews = await this.getReviews(session.id, input.businessId, tx);
      const reviewByItem = new Map(reviews.map((review) => [review.diagnosisItemId, review]));
      if (!proposals.length || proposals.some((proposal) => !reviewByItem.has(proposal.diagnosisItemId))
        || reviews.length !== proposals.length) {
        throw new Error("Every headline requires exactly one decision before the set is approved");
      }
      const approvedAt = new Date();
      await tx.update(diagnosisHeadlineReviewSessions)
        .set({ status: "COMPLETED", completedAt: approvedAt })
        .where(eq(diagnosisHeadlineReviewSessions.id, session.id));
      const [headlineSet] = await tx.insert(approvedDiagnosisHeadlineSets).values({
        businessId: input.businessId,
        approvedDiagnosisId: approved.id,
        approvedDiagnosisVersion: approved.version,
        diagnosisRunId: approved.analysisRunId,
        proposalRunId: session.proposalRunId,
        reviewSessionId: session.id,
        version: session.setVersion,
        approvedBy: locked.reviewerId,
        approvedAt,
      }).returning();
      for (const proposal of proposals) {
        const review = reviewByItem.get(proposal.diagnosisItemId)!;
        await tx.insert(approvedDiagnosisHeadlines).values({
          businessId: input.businessId,
          headlineSetId: headlineSet.id,
          approvedDiagnosisId: approved.id,
          diagnosisRunId: approved.analysisRunId,
          reviewSessionId: session.id,
          diagnosisItemId: proposal.diagnosisItemId,
          reviewId: review.id,
          itemRef: proposal.itemRef,
          headline: effectiveHeadline(proposal, review),
        });
      }
      return { headlineSet, approvedNow: true };
    });
  }
}
