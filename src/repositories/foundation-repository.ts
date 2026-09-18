import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businessProfiles,
  businesses,
  claimEvidence,
  claims,
  evidence,
  metrics,
  strategyWorkflows,
  workflowTransitions,
} from "@/db/schema";
import {
  businessInputSchema,
  businessProfileInputSchema,
  claimEvidenceInputSchema,
  claimInputSchema,
  evidenceInputSchema,
  metricInputSchema,
  type BusinessInput,
  type ClaimInput,
  type EvidenceInput,
  type MetricInput,
} from "@/domain/schemas";
import {
  assertActiveBusinessForUpdate,
  assertBusinessActive,
} from "@/repositories/business-lifecycle-guard";
import { createCanonicalSnapshot } from "@/repositories/canonical-snapshot";

export class FoundationRepository {
  constructor(private readonly database: Database) {}

  async createBusiness(input: BusinessInput) {
    const parsed = businessInputSchema.parse(input);
    return this.database.transaction(async (tx) => {
      const [business] = await tx.insert(businesses).values({
        name: parsed.name,
        legalName: parsed.legalName,
        websiteUrl: parsed.websiteUrl,
        sector: parsed.sector,
        primaryGeography: parsed.primaryGeography,
      }).returning();
      await tx.insert(businessProfiles).values({
        businessId: business.id,
        profileData: parsed.profileData,
      });
      await tx.insert(strategyWorkflows).values({ businessId: business.id });
      return business;
    });
  }

  async getBusinessIncludingArchived(businessId: string) {
    const [business] = await this.database.select().from(businesses)
      .where(eq(businesses.id, businessId));
    return business;
  }

  async getActiveBusiness(businessId: string) {
    const [business] = await this.database.select().from(businesses).where(and(
      eq(businesses.id, businessId),
      eq(businesses.status, "active"),
    ));
    return business;
  }

  listActiveBusinesses() {
    return this.database.select().from(businesses)
      .where(eq(businesses.status, "active"))
      .orderBy(businesses.createdAt);
  }

  listArchivedBusinesses() {
    return this.database.select().from(businesses)
      .where(eq(businesses.status, "archived"))
      .orderBy(businesses.archivedAt, businesses.createdAt);
  }

  assertBusinessActive(businessId: string) {
    return assertBusinessActive(this.database, businessId);
  }

  async archiveBusiness(businessId: string) {
    const now = new Date();
    const [business] = await this.database.update(businesses).set({
      status: "archived",
      archivedAt: now,
      updatedAt: now,
    }).where(and(
      eq(businesses.id, businessId),
      eq(businesses.status, "active"),
    )).returning();
    if (business) return business;
    const existing = await this.getBusinessIncludingArchived(businessId);
    if (!existing) throw new Error("Business not found");
    if (existing.status !== "archived") throw new Error("Unsupported Business lifecycle status");
    return existing;
  }

  async restoreBusiness(businessId: string) {
    const [business] = await this.database.update(businesses).set({
      status: "active",
      archivedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(businesses.id, businessId),
      eq(businesses.status, "archived"),
    )).returning();
    if (business) return business;
    const existing = await this.getBusinessIncludingArchived(businessId);
    if (!existing) throw new Error("Business not found");
    if (existing.status !== "active") throw new Error("Unsupported Business lifecycle status");
    return existing;
  }

  async updateBusinessProfile(input: { businessId: string; profileData: Record<string, unknown> }) {
    const parsed = businessProfileInputSchema.parse(input);
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, parsed.businessId);
      const [profile] = await tx.update(businessProfiles).set({
        profileData: parsed.profileData,
        updatedAt: new Date(),
      }).where(eq(businessProfiles.businessId, parsed.businessId)).returning();
      if (!profile) throw new Error("Business profile not found");
      return profile;
    });
  }

  async addClaim(input: ClaimInput) {
    const parsed = claimInputSchema.parse(input);
    if (parsed.claimType === "fact") {
      throw new Error("Facts must be created through FactAdmissionService");
    }
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, parsed.businessId);
      const [claim] = await tx.insert(claims).values({
        ...parsed,
        confidenceScore: parsed.confidenceScore?.toString(),
      }).returning();
      return claim;
    });
  }

  async getClaim(claimId: string) {
    const [claim] = await this.database.select().from(claims).where(eq(claims.id, claimId));
    return claim;
  }

  async supersedeClaim(
    claimId: string,
    replacement: ClaimInput,
  ) {
    const parsed = claimInputSchema.parse(replacement);
    if (parsed.claimType === "fact") {
      throw new Error("Facts must be promoted through FactAdmissionService");
    }
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, parsed.businessId);
      const [current] = await tx.select().from(claims).where(eq(claims.id, claimId)).for("update");
      if (!current) throw new Error("Claim not found");
      if (current.supersededByClaimId) throw new Error("Claim has already been superseded");
      if (current.businessId !== parsed.businessId) {
        throw new Error("Replacement claim must belong to the same business");
      }
      const [next] = await tx.insert(claims).values({
        ...parsed,
        confidenceScore: parsed.confidenceScore?.toString(),
      }).returning();
      await tx.update(claims).set({
        status: "superseded",
        supersededByClaimId: next.id,
        updatedAt: new Date(),
      }).where(eq(claims.id, current.id));
      return next;
    });
  }

  async addEvidence(input: EvidenceInput) {
    const parsed = evidenceInputSchema.parse(input);
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, parsed.businessId);
      const [item] = await tx.insert(evidence).values({
        ...parsed,
        valueNumeric: parsed.valueNumeric?.toString(),
        reliabilityScore: parsed.reliabilityScore?.toString(),
      }).returning();
      return item;
    });
  }

  async linkClaimEvidence(input: {
    claimId: string;
    evidenceId: string;
    relationshipType: "supports" | "contradicts" | "context";
    strengthScore?: number;
  }) {
    const parsed = claimEvidenceInputSchema.parse(input);
    const [knownClaim] = await this.database.select({ businessId: claims.businessId })
      .from(claims).where(eq(claims.id, parsed.claimId));
    if (!knownClaim) throw new Error("Claim and evidence must exist");
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, knownClaim.businessId);
      const [claim] = await tx.select({ businessId: claims.businessId })
        .from(claims).where(eq(claims.id, parsed.claimId));
      const [item] = await tx.select({ businessId: evidence.businessId })
        .from(evidence).where(eq(evidence.id, parsed.evidenceId));
      if (!claim || !item) throw new Error("Claim and evidence must exist");
      if (claim.businessId !== item.businessId) {
        throw new Error("Claim and evidence must belong to the same business");
      }
      const [link] = await tx.insert(claimEvidence).values({
        businessId: claim.businessId,
        ...parsed,
        strengthScore: parsed.strengthScore?.toString(),
      }).returning();
      return link;
    });
  }

  async addMetric(input: MetricInput) {
    const parsed = metricInputSchema.parse(input);
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, parsed.businessId);
      if (parsed.sourceEvidenceId) {
        const [source] = await tx.select({ businessId: evidence.businessId })
          .from(evidence).where(eq(evidence.id, parsed.sourceEvidenceId));
        if (!source || source.businessId !== parsed.businessId) {
          throw new Error("Metric source evidence must belong to the same business");
        }
      }
      const [metric] = await tx.insert(metrics).values({
        ...parsed,
        numericValue: parsed.numericValue.toString(),
      }).returning();
      return metric;
    });
  }

  async createSnapshot(businessId: string) {
    return this.database.transaction(async (tx) => {
      await assertActiveBusinessForUpdate(tx, businessId);
      return createCanonicalSnapshot(tx, businessId);
    });
  }

  async getWorkflow(businessId: string) {
    const [workflow] = await this.database.select().from(strategyWorkflows)
      .where(eq(strategyWorkflows.businessId, businessId));
    return workflow;
  }

  async getTransitionHistory(workflowId: string) {
    return this.database.select().from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, workflowId))
      .orderBy(workflowTransitions.createdAt);
  }
}
