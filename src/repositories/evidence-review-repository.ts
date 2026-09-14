import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businessProfiles,
  businesses,
  businessStateSnapshots,
  claimEvidence,
  claims,
  evidence,
  evidenceExtractionRuns,
  evidenceProposals,
  evidenceReviewSessions,
  metrics,
  proposalReviews,
  strategyWorkflows,
} from "@/db/schema";
import type { ReviewDecision } from "@/domain/evidence-review";
import { assertBusinessActive } from "@/repositories/business-lifecycle-guard";

export type CanonicalApplication =
  | { type: "none" }
  | {
    type: "claim";
    values: typeof claims.$inferInsert;
  }
  | {
    type: "evidence";
    values: typeof evidence.$inferInsert;
  }
  | {
    type: "metric";
    values: typeof metrics.$inferInsert;
  }
  | {
    type: "claim_evidence";
    values: typeof claimEvidence.$inferInsert;
  };

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class EvidenceReviewRepository {
  constructor(private readonly database: Database) {}

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async startSession(input: {
    businessId: string;
    extractionRunId: string;
    reviewerId: string;
  }) {
    return this.database.transaction(async (tx) => {
      const [run] = await tx.select().from(evidenceExtractionRuns).where(and(
        eq(evidenceExtractionRuns.id, input.extractionRunId),
        eq(evidenceExtractionRuns.businessId, input.businessId),
      )).for("update");
      if (!run) throw new Error("Evidence Extraction Run not found for Business");
      if (run.status !== "SUCCEEDED") {
        throw new Error("Only a SUCCEEDED Evidence Extraction Run may be reviewed");
      }

      const [existing] = await tx.select().from(evidenceReviewSessions)
        .where(eq(evidenceReviewSessions.extractionRunId, run.id));
      if (existing) {
        if (existing.reviewerId !== input.reviewerId) {
          throw new Error("Evidence Extraction Run already has a different reviewer");
        }
        return existing;
      }

      const [session] = await tx.insert(evidenceReviewSessions).values(input).returning();
      return session;
    });
  }

  async getSessionDetails(sessionId: string, businessId: string) {
    const [session] = await this.database.select().from(evidenceReviewSessions).where(and(
      eq(evidenceReviewSessions.id, sessionId),
      eq(evidenceReviewSessions.businessId, businessId),
    ));
    if (!session) throw new Error("Evidence Review Session not found");
    const [run, proposals, reviews] = await Promise.all([
      this.database.select().from(evidenceExtractionRuns)
        .where(eq(evidenceExtractionRuns.id, session.extractionRunId)).then((rows) => rows[0]),
      this.database.select().from(evidenceProposals)
        .where(eq(evidenceProposals.extractionRunId, session.extractionRunId))
        .orderBy(evidenceProposals.createdAt, evidenceProposals.proposalRef),
      this.database.select().from(proposalReviews)
        .where(eq(proposalReviews.reviewSessionId, session.id))
        .orderBy(proposalReviews.reviewedAt),
    ]);
    return { session, run, proposals, reviews };
  }

  async getSessionByRun(extractionRunId: string, businessId: string) {
    const [session] = await this.database.select().from(evidenceReviewSessions).where(and(
      eq(evidenceReviewSessions.extractionRunId, extractionRunId),
      eq(evidenceReviewSessions.businessId, businessId),
    ));
    return session;
  }

  async getExtractionDetails(extractionRunId: string, businessId: string) {
    const [run] = await this.database.select().from(evidenceExtractionRuns).where(and(
      eq(evidenceExtractionRuns.id, extractionRunId),
      eq(evidenceExtractionRuns.businessId, businessId),
    ));
    if (!run) throw new Error("Evidence Extraction Run not found for Business");
    const proposals = await this.database.select().from(evidenceProposals).where(and(
      eq(evidenceProposals.extractionRunId, run.id),
      eq(evidenceProposals.businessId, businessId),
    )).orderBy(evidenceProposals.createdAt, evidenceProposals.proposalRef);
    return { run, proposals };
  }

  async applyDecision(input: {
    businessId: string;
    reviewSessionId: string;
    proposalId: string;
    reviewerId: string;
    decision: ReviewDecision;
    reviewedPayload: Record<string, unknown> | null;
    reason?: string;
    canonical: CanonicalApplication;
  }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(evidenceReviewSessions).where(and(
        eq(evidenceReviewSessions.id, input.reviewSessionId),
        eq(evidenceReviewSessions.businessId, input.businessId),
      )).for("update");
      if (!session) throw new Error("Evidence Review Session not found");
      if (session.status !== "OPEN") throw new Error("Evidence Review Session is completed");
      if (session.reviewerId !== input.reviewerId) {
        throw new Error("Reviewer does not match the Evidence Review Session");
      }

      const [proposal] = await tx.select().from(evidenceProposals).where(and(
        eq(evidenceProposals.id, input.proposalId),
        eq(evidenceProposals.businessId, input.businessId),
        eq(evidenceProposals.extractionRunId, session.extractionRunId),
      )).for("update");
      if (!proposal) throw new Error("Proposal does not belong to the Review Session");

      const [existing] = await tx.select().from(proposalReviews)
        .where(eq(proposalReviews.proposalId, proposal.id));
      if (existing) {
        if (
          existing.decision === input.decision
          && sameJson(existing.reviewedPayload, input.reviewedPayload)
        ) return existing;
        throw new Error("Proposal already has a conflicting review decision");
      }

      let canonicalEntityType: typeof proposalReviews.$inferInsert.canonicalEntityType = null;
      let canonicalEntityId: string | null = null;
      let canonicalReference: Record<string, unknown> = {};

      if (input.canonical.type === "claim") {
        if (["fact", "decision"].includes(input.canonical.values.claimType)) {
          throw new Error("Evidence Review cannot create fact or decision Claims");
        }
        const [created] = await tx.insert(claims).values(input.canonical.values).returning();
        canonicalEntityType = "claim";
        canonicalEntityId = created.id;
      } else if (input.canonical.type === "evidence") {
        const [created] = await tx.insert(evidence).values(input.canonical.values).returning();
        canonicalEntityType = "evidence";
        canonicalEntityId = created.id;
      } else if (input.canonical.type === "metric") {
        const [created] = await tx.insert(metrics).values(input.canonical.values).returning();
        canonicalEntityType = "metric";
        canonicalEntityId = created.id;
      } else if (input.canonical.type === "claim_evidence") {
        const [created] = await tx.insert(claimEvidence).values(input.canonical.values).returning();
        canonicalEntityType = "claim_evidence";
        canonicalReference = {
          claimId: created.claimId,
          evidenceId: created.evidenceId,
          relationshipType: created.relationshipType,
        };
      }

      const [review] = await tx.insert(proposalReviews).values({
        reviewSessionId: session.id,
        proposalId: proposal.id,
        extractionRunId: session.extractionRunId,
        businessId: input.businessId,
        decision: input.decision,
        reviewedPayload: input.reviewedPayload,
        reason: input.reason,
        canonicalEntityType,
        canonicalEntityId,
        canonicalReference,
      }).returning();
      return review;
    });
  }

  async completeSession(input: {
    businessId: string;
    reviewSessionId: string;
    reviewerId: string;
  }) {
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(evidenceReviewSessions).where(and(
        eq(evidenceReviewSessions.id, input.reviewSessionId),
        eq(evidenceReviewSessions.businessId, input.businessId),
      )).for("update");
      if (!session) throw new Error("Evidence Review Session not found");
      if (session.reviewerId !== input.reviewerId) {
        throw new Error("Reviewer does not match the Evidence Review Session");
      }
      if (session.status === "COMPLETED") {
        const [[snapshot], [workflow]] = await Promise.all([
          tx.select().from(businessStateSnapshots)
            .where(eq(businessStateSnapshots.id, session.resultingSnapshotId!)),
          tx.select().from(strategyWorkflows)
            .where(eq(strategyWorkflows.businessId, input.businessId)),
        ]);
        return { session, snapshot, completedNow: false, workflowState: workflow?.state };
      }

      const [proposals, reviews] = await Promise.all([
        tx.select().from(evidenceProposals)
          .where(eq(evidenceProposals.extractionRunId, session.extractionRunId)),
        tx.select().from(proposalReviews)
          .where(eq(proposalReviews.reviewSessionId, session.id)),
      ]);
      if (proposals.length !== reviews.length) {
        throw new Error("Every proposal requires an explicit review decision");
      }
      const reviewedProposalIds = new Set(reviews.map((review) => review.proposalId));
      if (proposals.some((proposal) => !reviewedProposalIds.has(proposal.id))) {
        throw new Error("Every proposal requires an explicit review decision");
      }
      for (const review of reviews) {
        if (!["ACCEPTED", "CORRECTED"].includes(review.decision)) continue;
        const proposal = proposals.find((item) => item.id === review.proposalId)!;
        if (proposal.proposalType === "claim_evidence") {
          if (!review.canonicalReference.claimId || !review.canonicalReference.evidenceId) {
            throw new Error("Accepted relationship is missing canonical endpoints");
          }
        } else if (!review.canonicalEntityId || review.canonicalEntityType !== proposal.proposalType) {
          throw new Error("Accepted proposal is missing its canonical entity");
        }
      }

      const [workflow] = await tx.select().from(strategyWorkflows)
        .where(eq(strategyWorkflows.businessId, input.businessId));
      if (workflow?.state !== "EVIDENCE_PROCESSING") {
        throw new Error("Workflow must be EVIDENCE_PROCESSING to complete Evidence Review");
      }

      await tx.execute(sql`select id from businesses where id = ${input.businessId} for update`);
      const [business] = await tx.select().from(businesses)
        .where(eq(businesses.id, input.businessId));
      if (!business) throw new Error("Business not found");
      const [profile] = await tx.select().from(businessProfiles)
        .where(eq(businessProfiles.businessId, input.businessId));
      const businessClaims = await tx.select().from(claims)
        .where(eq(claims.businessId, input.businessId));
      const businessEvidence = await tx.select().from(evidence)
        .where(eq(evidence.businessId, input.businessId));
      const businessMetrics = await tx.select().from(metrics)
        .where(eq(metrics.businessId, input.businessId));
      const links = await tx.select().from(claimEvidence)
        .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
        .where(eq(claims.businessId, input.businessId));
      const [latest] = await tx.select({ version: businessStateSnapshots.version })
        .from(businessStateSnapshots)
        .where(eq(businessStateSnapshots.businessId, input.businessId))
        .orderBy(sql`${businessStateSnapshots.version} desc`).limit(1);
      const [snapshot] = await tx.insert(businessStateSnapshots).values({
        businessId: input.businessId,
        version: (latest?.version ?? 0) + 1,
        snapshotData: {
          business,
          profile: profile?.profileData ?? {},
          claims: businessClaims,
          evidence: businessEvidence,
          claimEvidence: links.map((row) => row.claim_evidence),
          metrics: businessMetrics,
        },
      }).returning();
      const completedAt = new Date();
      const [completed] = await tx.update(evidenceReviewSessions).set({
        status: "COMPLETED",
        resultingSnapshotId: snapshot.id,
        completedAt,
      }).where(eq(evidenceReviewSessions.id, session.id)).returning();
      return {
        session: completed,
        snapshot,
        completedNow: true,
        workflowState: workflow.state,
      };
    });
  }

  async getWorkflowState(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow?.state;
  }

  async getEvidenceStateData(businessId: string) {
    const [businessRows, claimRows, evidenceRows, metricRows, relationshipRows, reviewRows, proposalRows] = await Promise.all([
      this.database.select().from(businesses).where(eq(businesses.id, businessId)),
      this.database.select().from(claims).where(and(
        eq(claims.businessId, businessId),
        eq(claims.status, "active"),
      )).orderBy(claims.createdAt),
      this.database.select().from(evidence).where(eq(evidence.businessId, businessId))
        .orderBy(evidence.createdAt),
      this.database.select().from(metrics).where(eq(metrics.businessId, businessId))
        .orderBy(metrics.createdAt),
      this.database.select().from(claimEvidence)
        .where(eq(claimEvidence.businessId, businessId))
        .orderBy(claimEvidence.createdAt),
      this.database.select().from(proposalReviews)
        .where(eq(proposalReviews.businessId, businessId)),
      this.database.select().from(evidenceProposals)
        .where(eq(evidenceProposals.businessId, businessId)),
    ]);
    if (!businessRows[0]) throw new Error("Business not found");
    return {
      business: businessRows[0],
      claims: claimRows,
      evidence: evidenceRows,
      metrics: metricRows,
      relationships: relationshipRows,
      reviews: reviewRows,
      proposals: proposalRows,
    };
  }
}
