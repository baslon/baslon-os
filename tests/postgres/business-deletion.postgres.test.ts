import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceExtractionModel } from "@/ai/evidence-extractor/model";
import type { Database } from "@/db/client";
import {
  businessProfiles,
  businesses as businessTable,
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
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import {
  baslonClaims,
  baslonEvidence,
  baslonExtractionOutput,
  baslonMessyIntake,
  baslonMetric,
} from "../fixtures/baslon-business";
import {
  requirePostgresTestDatabaseUrl,
  verifyPostgresTestDatabase,
} from "../helpers/postgres-test-guard";

const connectionString = requirePostgresTestDatabaseUrl();

class FakeModel implements EvidenceExtractionModel {
  getConfiguration() {
    return { provider: "deletion-test", model: "fake-v1", metadata: { network: false } };
  }
  async extract() {
    return { output: baslonExtractionOutput, rawOutput: baslonExtractionOutput };
  }
}

type PopulatedBusiness = Awaited<ReturnType<typeof populateBusiness>>;
let database: Database;
let foundation: FoundationRepository;
let service: BusinessService;

async function graphCounts(target: PopulatedBusiness) {
  const directTables = [businessProfiles, businessStateSnapshots, claims, evidence, metrics,
    claimEvidence, strategyWorkflows, evidenceExtractionRuns, evidenceProposals,
    evidenceReviewSessions, proposalReviews, sourceSubmissionAttachments, sourceSubmissions] as const;
  const direct = await Promise.all(directTables.map(async (table) => {
    const [result] = await database.select({ value: count() }).from(table)
      .where(eq(table.businessId, target.business.id));
    return result.value;
  }));
  const [transitions] = await database.select({ value: count() }).from(workflowTransitions)
    .where(inArray(workflowTransitions.workflowId, target.workflowIds));
  const [root] = await database.select({ value: count() }).from(businessTable)
    .where(eq(businessTable.id, target.business.id));
  return { root: root.value, direct, transitions: transitions.value };
}

async function graphSnapshot(target: PopulatedBusiness) {
  const businessId = target.business.id;
  const workflowIds = target.workflowIds;
  const [
    businessRows,
    profileRows,
    claimRows,
    evidenceRows,
    metricRows,
    relationshipRows,
    snapshotRows,
    workflowRows,
    transitionRows,
    extractionRunRows,
    proposalRows,
    reviewSessionRows,
    proposalReviewRows,
    sourceAttachmentRows,
    sourceSubmissionRows,
  ] = await Promise.all([
    database.select().from(businessTable).where(eq(businessTable.id, businessId)).orderBy(businessTable.id),
    database.select().from(businessProfiles).where(eq(businessProfiles.businessId, businessId))
      .orderBy(businessProfiles.businessId),
    database.select().from(claims).where(eq(claims.businessId, businessId)).orderBy(claims.id),
    database.select().from(evidence).where(eq(evidence.businessId, businessId)).orderBy(evidence.id),
    database.select().from(metrics).where(eq(metrics.businessId, businessId)).orderBy(metrics.id),
    database.select().from(claimEvidence).where(eq(claimEvidence.businessId, businessId))
      .orderBy(claimEvidence.claimId, claimEvidence.evidenceId, claimEvidence.relationshipType),
    database.select().from(businessStateSnapshots).where(eq(businessStateSnapshots.businessId, businessId))
      .orderBy(businessStateSnapshots.id),
    database.select().from(strategyWorkflows).where(eq(strategyWorkflows.businessId, businessId))
      .orderBy(strategyWorkflows.id),
    database.select().from(workflowTransitions).where(inArray(workflowTransitions.workflowId, workflowIds))
      .orderBy(workflowTransitions.id),
    database.select().from(evidenceExtractionRuns).where(eq(evidenceExtractionRuns.businessId, businessId))
      .orderBy(evidenceExtractionRuns.id),
    database.select().from(evidenceProposals).where(eq(evidenceProposals.businessId, businessId))
      .orderBy(evidenceProposals.id),
    database.select().from(evidenceReviewSessions).where(eq(evidenceReviewSessions.businessId, businessId))
      .orderBy(evidenceReviewSessions.id),
    database.select().from(proposalReviews).where(eq(proposalReviews.businessId, businessId))
      .orderBy(proposalReviews.id),
    database.select().from(sourceSubmissionAttachments)
      .where(eq(sourceSubmissionAttachments.businessId, businessId))
      .orderBy(sourceSubmissionAttachments.id),
    database.select().from(sourceSubmissions).where(eq(sourceSubmissions.businessId, businessId))
      .orderBy(sourceSubmissions.id),
  ]);
  return {
    businesses: businessRows,
    businessProfiles: profileRows,
    claims: claimRows,
    evidence: evidenceRows,
    metrics: metricRows,
    claimEvidence: relationshipRows,
    businessStateSnapshots: snapshotRows,
    strategyWorkflows: workflowRows,
    workflowTransitions: transitionRows,
    evidenceExtractionRuns: extractionRunRows,
    evidenceProposals: proposalRows,
    evidenceReviewSessions: reviewSessionRows,
    proposalReviews: proposalReviewRows,
    sourceSubmissionAttachments: sourceAttachmentRows,
    sourceSubmissions: sourceSubmissionRows,
  };
}

async function populateBusiness(input: {
  name?: string;
  websiteUrl?: string;
  legalName?: string;
  primaryGeography?: string;
} = {}) {
  const business = await service.create({
    name: input.name ?? `Permanent delete test ${randomUUID()}`,
    websiteUrl: input.websiteUrl,
    legalName: input.legalName,
    primaryGeography: input.primaryGeography,
  });
  const originalClaim = await foundation.addClaim(baslonClaims(business.id)[0]);
  const replacementClaim = await foundation.supersedeClaim(originalClaim.id, {
    ...baslonClaims(business.id)[1],
    statement: "Replacement hypothesis for deletion testing.",
  });
  const [supersededOriginalClaim] = await database.select().from(claims)
    .where(eq(claims.id, originalClaim.id));
  const evidenceItem = await foundation.addEvidence(baslonEvidence(business.id));
  await foundation.linkClaimEvidence({
    claimId: replacementClaim.id,
    evidenceId: evidenceItem.id,
    relationshipType: "context",
  });
  await foundation.addMetric(baslonMetric(business.id, evidenceItem.id));
  const snapshot = await foundation.createSnapshot(business.id);
  const sourceService = new SourceSubmissionService(new SourceSubmissionRepository(database));
  const sourceSubmission = await sourceService.create({
    businessId: business.id,
    sourceType: "initial_intake",
    description: "Permanent deletion source fixture",
    rawText: baslonMessyIntake,
    sourceReference: "business-deletion-postgres-test",
  });
  const sourceAttachment = await sourceService.addAttachment({
    businessId: business.id,
    sourceSubmissionId: sourceSubmission.id,
    originalFilename: "supporting-notes.txt",
    mediaType: "text/plain",
    byteSize: 256,
  });
  const orchestrator = createStrategyOrchestrator(database);
  await orchestrator.transition({
    businessId: business.id,
    event: "START_INTAKE",
    actorType: "human",
    actorId: "deletion-test",
  });
  const extraction = await new EvidenceExtractionService(
    new EvidenceExtractionRepository(database),
    new FakeModel(),
  ).extract({
    businessId: business.id,
    sourceSubmissionId: sourceSubmission.id,
    rawIntakeText: baslonMessyIntake,
  });
  const reviewService = new EvidenceReviewService(
    new EvidenceReviewRepository(database),
    orchestrator,
  );
  const session = await reviewService.startReview({
    businessId: business.id,
    extractionRunId: extraction.run.id,
    reviewerId: "deletion-test",
  });
  await reviewService.reviewProposal({
    businessId: business.id,
    reviewSessionId: session.id,
    proposalId: extraction.proposals[0].id,
    reviewerId: "deletion-test",
    decision: "REJECTED",
  });
  const workflow = await foundation.getWorkflow(business.id);
  return {
    business,
    originalClaim: supersededOriginalClaim,
    replacementClaim,
    evidenceItem,
    snapshot,
    extraction,
    session,
    sourceSubmission,
    sourceAttachment,
    workflowIds: [workflow!.id],
  };
}

describe("real PostgreSQL 17 permanent Business deletion", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 8 });
    await verifyPostgresTestDatabase(pool);
    database = drizzle({ client: pool });
    foundation = new FoundationRepository(database);
    service = new BusinessService(foundation, new BusinessDeletionRepository(database));
  });

  afterAll(async () => pool.end());

  it("keeps direct root and immutable-record deletion restricted outside the pathway", async () => {
    const target = await populateBusiness();
    await service.archive(target.business.id);
    await expect(database.delete(businessTable).where(eq(businessTable.id, target.business.id))).rejects.toThrow();
    await expect(database.delete(evidence).where(eq(evidence.id, target.evidenceItem.id))).rejects.toThrow();
    await expect(database.delete(businessStateSnapshots).where(eq(businessStateSnapshots.id, target.snapshot.id))).rejects.toThrow();
    await expect(database.delete(evidenceProposals).where(eq(evidenceProposals.id, target.extraction.proposals[0].id))).rejects.toThrow();
    const [review] = await database.select().from(proposalReviews)
      .where(eq(proposalReviews.businessId, target.business.id));
    await expect(database.delete(proposalReviews).where(eq(proposalReviews.id, review.id))).rejects.toThrow();
    expect((await graphCounts(target)).root).toBe(1);
  });

  it("rejects active, incorrect-case and incorrect-wording confirmation, then accepts trimmed exact confirmation", async () => {
    const target = await populateBusiness();
    await expect(service.permanentlyDelete({
      businessId: target.business.id,
      confirmation: target.business.name,
    })).rejects.toThrow("must be archived");
    await service.archive(target.business.id);
    await expect(service.permanentlyDelete({
      businessId: target.business.id,
      confirmation: target.business.name.toLowerCase(),
    })).rejects.toThrow("does not match");
    await expect(service.permanentlyDelete({
      businessId: target.business.id,
      confirmation: `${target.business.name} Ltd`,
    })).rejects.toThrow("does not match");
    const result = await service.permanentlyDelete({
      businessId: target.business.id,
      confirmation: `  ${target.business.name}  `,
    });
    expect(result.businessId).toBe(target.business.id);
    expect(await graphCounts(target)).toEqual({ root: 0, direct: Array(13).fill(0), transitions: 0 });
    expect(await service.getIncludingArchived(target.business.id)).toBeUndefined();
    expect((await service.list()).map((business) => business.id)).not.toContain(target.business.id);
    expect((await service.listArchived()).map((business) => business.id)).not.toContain(target.business.id);
    expect(target.originalClaim.supersededByClaimId).toBe(target.replacementClaim.id);
  });

  it("uses Business ID and a disambiguated phrase to delete only one same-name complete graph", async () => {
    const name = `ABC Consulting ${randomUUID()}`;
    const first = await populateBusiness({ name, websiteUrl: "https://first.example.com" });
    const second = await populateBusiness({ name, websiteUrl: "https://second.example.com" });
    await service.archive(first.business.id);
    await service.archive(second.business.id);
    const secondCountsBefore = await graphCounts(second);
    const secondRowsBefore = await graphSnapshot(second);
    const confirmation = await service.getPermanentDeleteConfirmation(first.business.id);
    expect(confirmation.phrase).toBe(`${name} — first.example.com`);
    await expect(service.permanentlyDelete({ businessId: first.business.id, confirmation: name }))
      .rejects.toThrow("does not match");
    await service.permanentlyDelete({ businessId: first.business.id, confirmation: confirmation.phrase });
    expect(await graphCounts(first)).toEqual({ root: 0, direct: Array(13).fill(0), transitions: 0 });
    const secondCountsAfter = await graphCounts(second);
    const secondRowsAfter = await graphSnapshot(second);
    expect(secondCountsAfter).toEqual(secondCountsBefore);
    expect(secondRowsAfter).toEqual(secondRowsBefore);
    expect(secondRowsAfter.businesses).toHaveLength(1);
    expect(secondRowsAfter.businesses[0].id).toBe(second.business.id);
    expect(secondRowsAfter.businesses[0].name).toBe(name);
    expect(secondRowsAfter.businesses[0].websiteUrl).toBe("https://second.example.com");
  });

  it("rejects stale duplicate-name confirmation after identifying data changes", async () => {
    const name = `Stale Confirmation ${randomUUID()}`;
    const target = await populateBusiness({ name, websiteUrl: "https://before.example.com" });
    const other = await service.create({ name, websiteUrl: "https://other.example.com" });
    await service.archive(target.business.id);
    await service.archive(other.id);
    const stale = await service.getPermanentDeleteConfirmation(target.business.id);
    await database.update(businessTable).set({ websiteUrl: "https://after.example.com" })
      .where(eq(businessTable.id, target.business.id));
    await expect(service.permanentlyDelete({ businessId: target.business.id, confirmation: stale.phrase }))
      .rejects.toThrow("does not match");
    expect((await graphCounts(target)).root).toBe(1);
  });

  it("generates distinct stable fallback references for otherwise indistinguishable names", async () => {
    const name = `Fallback Consulting ${randomUUID()}`;
    const first = await service.create({ name });
    const second = await service.create({ name });
    await service.archive(first.id);
    await service.archive(second.id);
    const firstConfirmation = await service.getPermanentDeleteConfirmation(first.id);
    const secondConfirmation = await service.getPermanentDeleteConfirmation(second.id);
    expect(firstConfirmation.reference).toBeTruthy();
    expect(secondConfirmation.reference).toBeTruthy();
    expect(firstConfirmation.phrase).not.toBe(secondConfirmation.phrase);
    expect(firstConfirmation.phrase).not.toContain(first.id);
    expect(secondConfirmation.phrase).not.toContain(second.id);
    expect((await service.getPermanentDeleteConfirmation(first.id)).phrase).toBe(firstConfirmation.phrase);
  });

  it("keeps context Business-specific, DELETE-only, and transaction-local", async () => {
    const first = await populateBusiness();
    const second = await populateBusiness();
    await service.archive(first.business.id);
    await service.archive(second.business.id);

    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${first.business.id}, true)`);
      await tx.delete(evidence).where(eq(evidence.id, second.evidenceItem.id));
    })).rejects.toThrow();
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${first.business.id}, true)`);
      await tx.update(evidence).set({ statement: "Forbidden update" })
        .where(eq(evidence.id, first.evidenceItem.id));
    })).rejects.toThrow();
    await database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('baslon.permanent_delete_business_id', ${first.business.id}, true)`);
    });
    await expect(database.delete(evidence).where(eq(evidence.id, first.evidenceItem.id)))
      .rejects.toThrow();
    expect((await graphCounts(first)).root).toBe(1);
    expect((await graphCounts(second)).root).toBe(1);
  });

  it("rolls back every earlier deletion when a later graph step fails", async () => {
    const target = await populateBusiness();
    await service.archive(target.business.id);
    const before = await graphCounts(target);
    const claimsBefore = await database.select().from(claims)
      .where(eq(claims.businessId, target.business.id)).orderBy(claims.id);
    expect(claimsBefore).toHaveLength(2);
    const originalBefore = claimsBefore.find((claim) => claim.id === target.originalClaim.id);
    expect(originalBefore?.supersededByClaimId).toBe(target.replacementClaim.id);
    const identifier = `fail_profile_delete_${randomUUID().replaceAll("-", "")}`;
    await database.execute(sql.raw(`
      CREATE FUNCTION ${identifier}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced permanent-delete rollback';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${identifier}
      BEFORE DELETE ON business_profiles
      FOR EACH ROW EXECUTE FUNCTION ${identifier}();
    `));
    try {
      const confirmation = await service.getPermanentDeleteConfirmation(target.business.id);
      await expect(service.permanentlyDelete({
        businessId: target.business.id,
        confirmation: confirmation.phrase,
      })).rejects.toThrow();
      expect(await graphCounts(target)).toEqual(before);
      const claimsAfter = await database.select().from(claims)
        .where(eq(claims.businessId, target.business.id)).orderBy(claims.id);
      const originalAfter = claimsAfter.find((claim) => claim.id === target.originalClaim.id);
      expect(claimsAfter.map((claim) => claim.id)).toEqual(claimsBefore.map((claim) => claim.id));
      expect(originalAfter?.supersededByClaimId).toBe(target.replacementClaim.id);
      expect(claimsAfter).toEqual(claimsBefore);
    } finally {
      await database.execute(sql.raw(`
        DROP TRIGGER ${identifier} ON business_profiles;
        DROP FUNCTION ${identifier}();
      `));
    }
    await expect(database.delete(evidence).where(eq(evidence.id, target.evidenceItem.id)))
      .rejects.toThrow();
  });
});
