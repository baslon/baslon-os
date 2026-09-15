import { and, count, eq, inArray, sql } from "drizzle-orm";
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
  sourceSubmissionAttachments,
  sourceSubmissions,
  strategyWorkflows,
  workflowTransitions,
} from "@/db/schema";
import {
  BusinessDeletionError,
  deriveBusinessDeletionConfirmation,
  type BusinessDeletionConfirmation,
  type DeletionConfirmationBusiness,
} from "@/domain/business-deletion";

type ConfirmationModel = BusinessDeletionConfirmation & {
  business: DeletionConfirmationBusiness;
};

export class BusinessDeletionRepository {
  constructor(private readonly database: Database) {}

  async getConfirmation(businessId: string): Promise<ConfirmationModel> {
    const [business] = await this.businessWithProfile(this.database, businessId);
    if (!business) throw new BusinessDeletionError("Business not found.");
    if (business.status !== "archived") {
      throw new BusinessDeletionError("Business must be archived before it can be permanently deleted.");
    }
    const sameName = await this.sameNameBusinesses(this.database, business.name);
    return { business, ...deriveBusinessDeletionConfirmation(business, sameName) };
  }

  async permanentlyDelete(input: { businessId: string; confirmation: string }) {
    return this.database.transaction(async (tx) => {
      const [businessRow] = await tx.select().from(businesses)
        .where(eq(businesses.id, input.businessId))
        .for("update");
      if (!businessRow) throw new BusinessDeletionError("Business not found.");
      if (businessRow.status !== "archived") {
        throw new BusinessDeletionError("Business must be archived before it can be permanently deleted.");
      }
      const [business] = await this.businessWithProfile(tx, businessRow.id);
      if (!business) throw new BusinessDeletionError("Business not found.");

      const sameName = await this.sameNameBusinesses(tx, business.name);
      const expected = deriveBusinessDeletionConfirmation(business, sameName);
      if (input.confirmation.trim() !== expected.phrase) {
        throw new BusinessDeletionError("Business confirmation does not match.");
      }

      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${business.id}, true)`);

      const workflowRows = await tx.select({ id: strategyWorkflows.id }).from(strategyWorkflows)
        .where(eq(strategyWorkflows.businessId, business.id));
      const workflowIds = workflowRows.map((workflow) => workflow.id);

      await tx.delete(proposalReviews).where(eq(proposalReviews.businessId, business.id));
      await tx.delete(evidenceReviewSessions).where(eq(evidenceReviewSessions.businessId, business.id));
      await tx.delete(evidenceProposals).where(eq(evidenceProposals.businessId, business.id));
      await tx.delete(evidenceExtractionRuns).where(eq(evidenceExtractionRuns.businessId, business.id));
      await tx.delete(sourceSubmissionAttachments)
        .where(eq(sourceSubmissionAttachments.businessId, business.id));
      await tx.delete(sourceSubmissions).where(eq(sourceSubmissions.businessId, business.id));
      await tx.delete(claimEvidence).where(eq(claimEvidence.businessId, business.id));
      await tx.delete(metrics).where(eq(metrics.businessId, business.id));
      await tx.update(claims).set({ supersededByClaimId: null })
        .where(eq(claims.businessId, business.id));
      await tx.delete(claims).where(eq(claims.businessId, business.id));
      await tx.delete(evidence).where(eq(evidence.businessId, business.id));
      await tx.delete(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, business.id));
      if (workflowIds.length > 0) {
        await tx.delete(workflowTransitions).where(inArray(workflowTransitions.workflowId, workflowIds));
      }
      await tx.delete(strategyWorkflows).where(eq(strategyWorkflows.businessId, business.id));
      await tx.delete(businessProfiles).where(eq(businessProfiles.businessId, business.id));

      const directTables = [
        proposalReviews,
        evidenceReviewSessions,
        evidenceProposals,
        evidenceExtractionRuns,
        sourceSubmissionAttachments,
        sourceSubmissions,
        claimEvidence,
        metrics,
        claims,
        evidence,
        businessStateSnapshots,
        strategyWorkflows,
        businessProfiles,
      ] as const;
      const directCounts: number[] = [];
      for (const table of directTables) {
        const [result] = await tx.select({ value: count() }).from(table)
          .where(eq(table.businessId, business.id));
        directCounts.push(result.value);
      }
      const transitionCounts = workflowIds.length === 0
        ? 0
        : (await tx.select({ value: count() }).from(workflowTransitions)
          .where(inArray(workflowTransitions.workflowId, workflowIds)))[0].value;
      if (directCounts.some((value) => value !== 0) || transitionCounts !== 0) {
        throw new Error("Business-owned data remains after deletion sequence");
      }

      const [deleted] = await tx.delete(businesses).where(and(
        eq(businesses.id, business.id),
        eq(businesses.status, "archived"),
      )).returning({ id: businesses.id });
      if (!deleted) throw new Error("Business could not be permanently deleted");
      const [remainingBusiness] = await tx.select({ value: count() }).from(businesses)
        .where(eq(businesses.id, business.id));
      if (remainingBusiness.value !== 0) throw new Error("Business remains after deletion sequence");
      return { businessId: deleted.id };
    }, { isolationLevel: "serializable" });
  }

  private async sameNameBusinesses(
    database: Pick<Database, "select">,
    name: string,
  ): Promise<DeletionConfirmationBusiness[]> {
    return database.select({
      id: businesses.id,
      name: businesses.name,
      websiteUrl: businesses.websiteUrl,
      legalName: businesses.legalName,
      primaryGeography: businesses.primaryGeography,
      profileData: businessProfiles.profileData,
      status: businesses.status,
      archivedAt: businesses.archivedAt,
    }).from(businesses)
      .leftJoin(businessProfiles, eq(businessProfiles.businessId, businesses.id))
      .where(eq(businesses.name, name))
      .then((rows) => rows.map((row) => ({ ...row, profileData: row.profileData ?? {} })));
  }

  private async businessWithProfile(
    database: Pick<Database, "select">,
    businessId: string,
  ): Promise<DeletionConfirmationBusiness[]> {
    return database.select({
      id: businesses.id,
      name: businesses.name,
      websiteUrl: businesses.websiteUrl,
      legalName: businesses.legalName,
      primaryGeography: businesses.primaryGeography,
      profileData: businessProfiles.profileData,
      status: businesses.status,
      archivedAt: businesses.archivedAt,
    }).from(businesses)
      .leftJoin(businessProfiles, eq(businessProfiles.businessId, businesses.id))
      .where(eq(businesses.id, businessId))
      .then((rows) => rows.map((row) => ({ ...row, profileData: row.profileData ?? {} })));
  }
}
