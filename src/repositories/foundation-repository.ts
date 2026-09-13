import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businessProfiles,
  businesses,
  businessStateSnapshots,
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

  async listBusinesses() {
    return this.database.select().from(businesses).orderBy(businesses.createdAt);
  }

  async archiveBusiness(businessId: string) {
    const [business] = await this.database.update(businesses).set({
      status: "archived",
      archivedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(businesses.id, businessId)).returning();
    if (!business) throw new Error("Business not found");
    return business;
  }

  async updateBusinessProfile(input: { businessId: string; profileData: Record<string, unknown> }) {
    const parsed = businessProfileInputSchema.parse(input);
    const [profile] = await this.database.update(businessProfiles).set({
      profileData: parsed.profileData,
      updatedAt: new Date(),
    }).where(eq(businessProfiles.businessId, parsed.businessId)).returning();
    if (!profile) throw new Error("Business profile not found");
    return profile;
  }

  async addClaim(input: ClaimInput) {
    const parsed = claimInputSchema.parse(input);
    if (parsed.claimType === "fact") {
      throw new Error("Facts must be created through FactAdmissionService");
    }
    const [claim] = await this.database.insert(claims).values({
      ...parsed,
      confidenceScore: parsed.confidenceScore?.toString(),
    }).returning();
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
    const [item] = await this.database.insert(evidence).values({
      ...parsed,
      valueNumeric: parsed.valueNumeric?.toString(),
      reliabilityScore: parsed.reliabilityScore?.toString(),
    }).returning();
    return item;
  }

  async linkClaimEvidence(input: {
    claimId: string;
    evidenceId: string;
    relationshipType: "supports" | "contradicts" | "context";
    strengthScore?: number;
  }) {
    const parsed = claimEvidenceInputSchema.parse(input);
    return this.database.transaction(async (tx) => {
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
    if (parsed.sourceEvidenceId) {
      const [source] = await this.database.select({ businessId: evidence.businessId })
        .from(evidence).where(eq(evidence.id, parsed.sourceEvidenceId));
      if (!source || source.businessId !== parsed.businessId) {
        throw new Error("Metric source evidence must belong to the same business");
      }
    }
    const [metric] = await this.database.insert(metrics).values({
      ...parsed,
      numericValue: parsed.numericValue.toString(),
    }).returning();
    return metric;
  }

  async createSnapshot(businessId: string) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select id from businesses where id = ${businessId} for update`);
      const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
      if (!business) throw new Error("Business not found");
      const [profile] = await tx.select().from(businessProfiles)
        .where(eq(businessProfiles.businessId, businessId));
      const businessClaims = await tx.select().from(claims).where(eq(claims.businessId, businessId));
      const businessEvidence = await tx.select().from(evidence).where(eq(evidence.businessId, businessId));
      const businessMetrics = await tx.select().from(metrics).where(eq(metrics.businessId, businessId));
      const links = await tx.select().from(claimEvidence)
        .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
        .where(eq(claims.businessId, businessId));
      const [latest] = await tx.select({ version: businessStateSnapshots.version })
        .from(businessStateSnapshots)
        .where(eq(businessStateSnapshots.businessId, businessId))
        .orderBy(sql`${businessStateSnapshots.version} desc`).limit(1);
      const [snapshot] = await tx.insert(businessStateSnapshots).values({
        businessId,
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
      return snapshot;
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
