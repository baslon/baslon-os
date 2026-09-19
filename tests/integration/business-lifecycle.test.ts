import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceExtractionModel } from "@/ai/evidence-extractor/model";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import {
  businessProfiles,
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
  workflowTransitions,
} from "@/db/schema";
import { deriveHumanAuthority } from "@/domain/server-authority";
import { BusinessOverviewRepository } from "@/repositories/business-overview-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FactAdmissionRepository } from "@/repositories/fact-admission-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessOverviewService } from "@/services/business-overview-service";
import { BusinessService } from "@/services/business-service";
import { BusinessStateService } from "@/services/business-state-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { EvidenceStateService } from "@/services/evidence-state-service";
import { FactAdmissionService } from "@/services/fact-admission-service";
import {
  baslonBusiness,
  baslonClaims,
  baslonEvidence,
  baslonExtractionOutput,
  baslonMessyIntake,
  baslonMetric,
} from "../fixtures/baslon-business";

class FakeModel implements EvidenceExtractionModel {
  calls = 0;

  getConfiguration() {
    return { provider: "lifecycle-test", model: "fake-v1", metadata: { network: false } };
  }

  async extract() {
    this.calls += 1;
    return { output: baslonExtractionOutput, rawOutput: baslonExtractionOutput };
  }
}

describe("Business Archive and Restore lifecycle", () => {
  let client: PGlite;
  let database: Database;
  let foundation: FoundationRepository;
  let businesses: BusinessService;

  beforeAll(async () => {
    client = new PGlite();
    await applyMigrations(client);
    database = drizzle(client, { schema }) as unknown as Database;
    foundation = new FoundationRepository(database);
    businesses = new BusinessService(foundation);
  }, 30_000);

  afterAll(async () => client.close());

  async function graphCounts(businessId: string) {
    const directTables = [businessProfiles, businessStateSnapshots, claims, evidence, metrics,
      claimEvidence, strategyWorkflows, evidenceExtractionRuns, evidenceProposals,
      evidenceReviewSessions, proposalReviews] as const;
    const values = await Promise.all(directTables.map(async (table) => {
      const [result] = await database.select({ value: count() }).from(table)
        .where(eq(table.businessId, businessId));
      return result.value;
    }));
    const workflow = await foundation.getWorkflow(businessId);
    const [transitionCount] = await database.select({ value: count() }).from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, workflow!.id));
    return [...values, transitionCount.value];
  }

  it("archives idempotently, preserves the graph, isolates other Businesses, and restores", async () => {
    const business = await businesses.create({ ...baslonBusiness, name: `Lifecycle ${crypto.randomUUID()}` });
    const other = await businesses.create({ name: `Unaffected ${crypto.randomUUID()}` });
    const claim = await foundation.addClaim(baslonClaims(business.id)[0]);
    const evidenceItem = await foundation.addEvidence(baslonEvidence(business.id));
    await foundation.linkClaimEvidence({ claimId: claim.id, evidenceId: evidenceItem.id, relationshipType: "context" });
    await foundation.addMetric(baslonMetric(business.id, evidenceItem.id));
    await foundation.createSnapshot(business.id);
    await createStrategyOrchestrator(database).transition({
      businessId: business.id, event: "START_INTAKE", actorType: "human", actorId: "David",
    });
    const before = await graphCounts(business.id);
    const otherBefore = await graphCounts(other.id);

    const archived = await businesses.archive(business.id);
    expect(archived).toMatchObject({ id: business.id, status: "archived", archivedAt: expect.any(Date) });
    expect(archived.updatedAt.getTime()).toBeGreaterThanOrEqual(business.updatedAt.getTime());
    const repeated = await businesses.archive(business.id);
    expect(repeated.archivedAt?.getTime()).toBe(archived.archivedAt?.getTime());
    expect(repeated.updatedAt.getTime()).toBe(archived.updatedAt.getTime());
    expect(await graphCounts(business.id)).toEqual(before);
    expect(await graphCounts(other.id)).toEqual(otherBefore);
    expect((await businesses.list()).map((item) => item.id)).not.toContain(business.id);
    expect((await businesses.listArchived()).map((item) => item.id)).toContain(business.id);

    const overview = new BusinessOverviewService(new BusinessOverviewRepository(database));
    expect(await overview.get(business.id)).toBeUndefined();
    expect((await overview.getWorkspaceOverview()).businesses.map((item) => item.business.id)).not.toContain(business.id);
    expect((await overview.listArchived()).map((item) => item.business.id)).toContain(business.id);
    expect((await overview.getIncludingArchived(business.id))?.business.status).toBe("archived");
    expect((await new EvidenceStateService(new EvidenceReviewRepository(database)).getCurrent(business.id)).business.status).toBe("archived");

    const restored = await businesses.restore(business.id);
    expect(restored).toMatchObject({ id: business.id, status: "active", archivedAt: null });
    const repeatedRestore = await businesses.restore(business.id);
    expect(repeatedRestore.updatedAt.getTime()).toBe(restored.updatedAt.getTime());
    expect(await graphCounts(business.id)).toEqual(before);
    expect((await businesses.list()).map((item) => item.id)).toContain(business.id);
    expect((await businesses.listArchived()).map((item) => item.id)).not.toContain(business.id);
  });

  it("rejects every strategic mutation while archived and retains read access", async () => {
    const business = await businesses.create({ name: `Archived guard ${crypto.randomUUID()}` });
    const claim = await foundation.addClaim(baslonClaims(business.id)[0]);
    const evidenceItem = await foundation.addEvidence(baslonEvidence(business.id));
    const extractionRepository = new EvidenceExtractionRepository(database);
    const model = new FakeModel();
    const extractionService = new EvidenceExtractionService(extractionRepository, model);
    const orchestrator = createStrategyOrchestrator(database);
    await orchestrator.transition({ businessId: business.id, event: "START_INTAKE", actorType: "human" });
    await orchestrator.transition({ businessId: business.id, event: "SUBMIT_INTAKE", actorType: "human" });
    await orchestrator.transition({ businessId: business.id, event: "PROCESS_EVIDENCE", actorType: "system" });
    const extraction = await extractionService.extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
    });
    const reviewService = new EvidenceReviewService(
      new EvidenceReviewRepository(database),
      createStrategyOrchestrator(database),
    );
    const session = await reviewService.startReview({
      businessId: business.id,
      extractionRunId: extraction.run.id,
      reviewerId: "David",
    });
    const proposal = extraction.proposals[0];
    const before = await graphCounts(business.id);
    await businesses.archive(business.id);

    await expect(new BusinessStateService(foundation).updateProfile({
      businessId: business.id, profileData: { changed: true },
    })).rejects.toThrow("archived");
    await expect(extractionService.extract({
      businessId: business.id, rawIntakeText: baslonMessyIntake,
    })).rejects.toThrow("archived");
    expect(model.calls).toBe(1);
    await expect(reviewService.startReview({
      businessId: business.id, extractionRunId: extraction.run.id, reviewerId: "David",
    })).rejects.toThrow("archived");
    await expect(reviewService.reviewProposal({
      businessId: business.id,
      reviewSessionId: session.id,
      proposalId: proposal.id,
      reviewerId: "David",
      decision: "REJECTED",
    })).rejects.toThrow("archived");
    await expect(reviewService.completeReview({
      businessId: business.id, reviewSessionId: session.id, reviewerId: "David",
    })).rejects.toThrow("archived");
    await expect(new FactAdmissionService(new FactAdmissionRepository(database)).promoteToFact({
      currentClaimId: claim.id,
      claim: {
        businessId: business.id,
        statement: claim.statement,
        subjectArea: claim.subjectArea,
        confidenceLevel: "high",
        confidenceBasis: { basis: "test" },
        sourceType: "human_fact_admission",
      },
      supportingEvidenceIds: [evidenceItem.id],
      authority: deriveHumanAuthority({ actorType: "human", actorId: "David" }),
    })).rejects.toThrow("archived");
    await expect(createStrategyOrchestrator(database).transition({
      businessId: business.id, event: "START_INTAKE", actorType: "human", actorId: "David",
    })).rejects.toThrow("archived");

    expect(await graphCounts(business.id)).toEqual(before);
    expect((await new EvidenceStateService(new EvidenceReviewRepository(database)).getCurrent(business.id)).business.id).toBe(business.id);
  });
});
