import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EvidenceExtractionModel,
  EvidenceExtractionModelConfiguration,
  EvidenceExtractionModelResult,
} from "@/ai/evidence-extractor/model";
import type { Database } from "@/db/client";
import {
  businessStateSnapshots,
  claims,
  evidenceProposals,
  evidenceReviewSessions,
  proposalReviews,
} from "@/db/schema";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import {
  baslonBusiness,
  baslonExtractionOutput,
  baslonMessyIntake,
} from "../fixtures/baslon-business";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for real PostgreSQL verification");
}

class FakeModel implements EvidenceExtractionModel {
  getConfiguration(): EvidenceExtractionModelConfiguration {
    return { provider: "postgres-review-test", model: "deterministic-v1", metadata: {} };
  }

  async extract(): Promise<EvidenceExtractionModelResult> {
    const output = structuredClone(baslonExtractionOutput);
    output.claims.push({
      proposalRef: "claim_4",
      statement: "This proposal will be explicitly rejected.",
      claimType: "observation",
      subjectArea: "review_test",
      confidenceLevel: "low",
      confidenceScore: 0.2,
      confidenceBasis: { basis: "PostgreSQL review test" },
      sourceType: "business_intake",
    });
    return { output, rawOutput: output };
  }
}

describe("real PostgreSQL 17 Evidence Review verification", () => {
  let pool: Pool;
  let database: Database;
  let foundation: FoundationRepository;
  let reviewRepository: EvidenceReviewRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 6 });
    database = drizzle({ client: pool });
    foundation = new FoundationRepository(database);
    reviewRepository = new EvidenceReviewRepository(database);
    const version = await database.execute<{ server_version_num: string }>(sql`show server_version_num`);
    expect(Number(version.rows[0].server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(version.rows[0].server_version_num)).toBeLessThan(180000);
  });

  afterAll(async () => pool.end());

  async function setup(label: string) {
    const business = await new BusinessService(foundation).create({
      ...baslonBusiness,
      name: `${label} ${randomUUID()}`,
    });
    const extraction = await new EvidenceExtractionService(
      new EvidenceExtractionRepository(database),
      new FakeModel(),
    ).extract({ businessId: business.id, rawIntakeText: baslonMessyIntake });
    const orchestrator = createStrategyOrchestrator(database);
    const service = new EvidenceReviewService(reviewRepository, orchestrator);
    const session = await service.startReview({
      businessId: business.id,
      extractionRunId: extraction.run.id,
      reviewerId: "David",
    });
    const details = await service.getReview(session.id, business.id);
    return {
      business,
      extraction,
      orchestrator,
      service,
      session,
      proposals: new Map(details.proposals.map((proposal) => [proposal.proposalRef, proposal])),
    };
  }

  it("persists audited decisions and completes exactly once", async () => {
    const context = await setup("PostgreSQL evidence review");
    const decide = (proposalRef: string, decision: "ACCEPTED" | "CORRECTED" | "REJECTED" | "UNRESOLVED", correctedPayload?: Record<string, unknown>) => (
      context.service.reviewProposal({
        businessId: context.business.id,
        reviewSessionId: context.session.id,
        proposalId: context.proposals.get(proposalRef)!.id,
        reviewerId: "David",
        decision,
        correctedPayload,
        reason: decision === "REJECTED" || decision === "UNRESOLVED" ? "Explicit human decision" : undefined,
      })
    );

    const acceptedClaim = await decide("claim_1", "ACCEPTED");
    const repeated = await decide("claim_1", "ACCEPTED");
    expect(repeated.id).toBe(acceptedClaim.id);
    await decide("claim_2", "CORRECTED", {
      statement: "£7.5k+ remains an unvalidated commercial hypothesis.",
    });
    await decide("claim_3", "UNRESOLVED");
    await decide("claim_4", "REJECTED");
    await decide("evidence_1", "ACCEPTED");
    await decide("metric_1", "ACCEPTED");
    await decide("relationship_1", "ACCEPTED");

    const reviews = await database.select().from(proposalReviews)
      .where(eq(proposalReviews.reviewSessionId, context.session.id));
    expect(reviews).toHaveLength(7);
    expect((await database.select({ value: count() }).from(claims)
      .where(eq(claims.businessId, context.business.id)))[0].value).toBe(2);
    expect(reviews.find((review) => review.decision === "REJECTED")).toMatchObject({
      canonicalEntityType: null,
      canonicalEntityId: null,
    });
    expect(reviews.find((review) => review.decision === "UNRESOLVED")).toMatchObject({
      canonicalEntityType: null,
      canonicalEntityId: null,
    });

    for (const [event, actorType] of [
      ["START_INTAKE", "human"],
      ["SUBMIT_INTAKE", "human"],
      ["PROCESS_EVIDENCE", "system"],
    ] as const) {
      await context.orchestrator.transition({
        businessId: context.business.id,
        event,
        actorType,
        actorId: "postgres-review-test",
      });
    }
    const first = await context.service.completeReview({
      businessId: context.business.id,
      reviewSessionId: context.session.id,
      reviewerId: "David",
    });
    const second = await context.service.completeReview({
      businessId: context.business.id,
      reviewSessionId: context.session.id,
      reviewerId: "David",
    });
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect((await foundation.getWorkflow(context.business.id))?.state).toBe("EVIDENCE_READY");
    expect((await database.select({ value: count() }).from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, context.business.id)))[0].value).toBe(1);

    const originalClaim = context.proposals.get("claim_1")!;
    await expect(database.update(evidenceProposals)
      .set({ structuredPayload: { tampered: true } })
      .where(eq(evidenceProposals.id, originalClaim.id))).rejects.toThrow();
  });

  it("rolls back canonical state when its review audit cannot be inserted", async () => {
    const context = await setup("PostgreSQL review atomicity");
    const proposal = context.proposals.get("claim_1")!;
    const before = (await database.select({ value: count() }).from(claims)
      .where(eq(claims.businessId, context.business.id)))[0].value;

    await expect(reviewRepository.applyDecision({
      businessId: context.business.id,
      reviewSessionId: context.session.id,
      proposalId: proposal.id,
      reviewerId: "David",
      decision: "REJECTED",
      reviewedPayload: null,
      reason: "Force database audit constraint failure",
      canonical: {
        type: "claim",
        values: {
          businessId: context.business.id,
          statement: "Must be rolled back",
          claimType: "hypothesis",
          subjectArea: "test",
          confidenceLevel: "low",
          confidenceBasis: {},
          sourceType: "test",
        },
      },
    })).rejects.toThrow();
    expect((await database.select({ value: count() }).from(claims)
      .where(eq(claims.businessId, context.business.id)))[0].value).toBe(before);
    expect(await database.select().from(proposalReviews)
      .where(eq(proposalReviews.proposalId, proposal.id))).toEqual([]);
  });

  it("rejects cross-Business review associations at the database boundary", async () => {
    const owner = await setup("PostgreSQL review owner");
    const other = await setup("PostgreSQL review foreign business");
    const proposal = owner.proposals.get("claim_1")!;

    await expect(database.insert(proposalReviews).values({
      reviewSessionId: other.session.id,
      proposalId: proposal.id,
      extractionRunId: owner.extraction.run.id,
      businessId: owner.business.id,
      decision: "UNRESOLVED",
      reason: "Must fail same-Business/session/run constraint",
    })).rejects.toThrow();
    expect(await database.select().from(proposalReviews).where(and(
      eq(proposalReviews.reviewSessionId, other.session.id),
      eq(proposalReviews.proposalId, proposal.id),
    ))).toEqual([]);

    await expect(database.insert(evidenceReviewSessions).values({
      businessId: other.business.id,
      extractionRunId: owner.extraction.run.id,
      reviewerId: "David",
    })).rejects.toThrow();
  });
});
