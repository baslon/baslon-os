import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businesses,
  evidenceExtractionRuns,
  evidenceProposals,
  evidenceReviewSessions,
  proposalReviews,
  strategyWorkflows,
} from "@/db/schema";

export class BusinessOverviewRepository {
  constructor(private readonly database: Database) {}

  async list() {
    const businessRows = await this.database.select().from(businesses)
      .where(eq(businesses.status, "active"))
      .orderBy(businesses.createdAt);
    return Promise.all(businessRows.map((business) => this.getForBusiness(business)));
  }

  async get(businessId: string) {
    const [business] = await this.database.select().from(businesses).where(and(
      eq(businesses.id, businessId),
      eq(businesses.status, "active"),
    ));
    if (!business) return undefined;
    return this.getForBusiness(business);
  }

  private async getForBusiness(business: typeof businesses.$inferSelect) {
    const [workflowRows, extractionRows, sessionRows, reviewRows, proposalRows] = await Promise.all([
      this.database.select().from(strategyWorkflows)
        .where(eq(strategyWorkflows.businessId, business.id)),
      this.database.select().from(evidenceExtractionRuns)
        .where(eq(evidenceExtractionRuns.businessId, business.id))
        .orderBy(desc(evidenceExtractionRuns.createdAt)),
      this.database.select().from(evidenceReviewSessions)
        .where(eq(evidenceReviewSessions.businessId, business.id))
        .orderBy(desc(evidenceReviewSessions.createdAt)),
      this.database.select().from(proposalReviews)
        .where(eq(proposalReviews.businessId, business.id)),
      this.database.select().from(evidenceProposals)
        .where(eq(evidenceProposals.businessId, business.id)),
    ]);
    const latestExtraction = extractionRows[0];
    const reviewSession = latestExtraction
      ? sessionRows.find((session) => session.extractionRunId === latestExtraction.id)
      : sessionRows[0];
    const activityTimes = [
      business.updatedAt,
      latestExtraction?.createdAt,
      reviewSession?.createdAt,
      ...reviewRows.map((review) => review.reviewedAt),
    ].filter((value): value is Date => value instanceof Date);
    const currentReviews = reviewSession
      ? reviewRows.filter((review) => review.reviewSessionId === reviewSession.id)
      : [];
    const currentProposals = latestExtraction
      ? proposalRows.filter((proposal) => proposal.extractionRunId === latestExtraction.id)
      : [];
    return {
      business,
      workflow: workflowRows[0],
      latestExtraction,
      reviewSession,
      reviewedCount: reviewRows.length,
      currentReviewedCount: currentReviews.length,
      currentProposalCount: currentProposals.length,
      lastActivityAt: new Date(Math.max(...activityTimes.map((value) => value.getTime()))),
    };
  }
}
