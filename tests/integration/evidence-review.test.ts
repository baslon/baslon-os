import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceExtractionOutput } from "@/ai/evidence-extractor/contracts";
import type {
  EvidenceExtractionModel,
  EvidenceExtractionModelConfiguration,
  EvidenceExtractionModelResult,
} from "@/ai/evidence-extractor/model";
import type { Database } from "@/db/client";
import {
  businessStateSnapshots,
  claims,
  evidence,
  evidenceProposals,
  metrics,
  proposalReviews,
} from "@/db/schema";
import { deriveHumanAuthority } from "@/domain/server-authority";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FactAdmissionRepository } from "@/repositories/fact-admission-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { EvidenceStateService } from "@/services/evidence-state-service";
import { FactAdmissionService } from "@/services/fact-admission-service";
import {
  baslonBusiness,
  baslonExtractionOutput,
  baslonMessyIntake,
} from "../fixtures/baslon-business";

class FakeModel implements EvidenceExtractionModel {
  constructor(private readonly result: EvidenceExtractionModelResult) {}

  getConfiguration(): EvidenceExtractionModelConfiguration {
    return { provider: "review-test", model: "fake-v1", metadata: { network: false } };
  }

  async extract() {
    return this.result;
  }
}

describe("Milestone 2B Evidence Review", () => {
  let client: PGlite;
  let database: Database;
  let foundationRepository: FoundationRepository;
  let extractionRepository: EvidenceExtractionRepository;
  let reviewRepository: EvidenceReviewRepository;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    for (const migrationPath of [
      "../../drizzle/0000_furry_wolf_cub.sql",
      "../../drizzle/0001_evidence_extraction.sql",
      "../../drizzle/0002_evidence_review.sql",
    ]) {
      const migration = await readFile(new URL(migrationPath, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.exec(statement);
      }
    }
    database = drizzle(client, { schema: await import("@/db/schema") }) as unknown as Database;
    foundationRepository = new FoundationRepository(database);
    extractionRepository = new EvidenceExtractionRepository(database);
    reviewRepository = new EvidenceReviewRepository(database);
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  async function extractedBusiness(output: EvidenceExtractionOutput = baslonExtractionOutput) {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: `${baslonBusiness.name} ${crypto.randomUUID()}`,
    });
    const extraction = await new EvidenceExtractionService(
      extractionRepository,
      new FakeModel({ output, rawOutput: output }),
    ).extract({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceType: "business_intake",
      sourceReference: "Baslon #001 review fixture",
    });
    const reviewService = new EvidenceReviewService(
      reviewRepository,
      createStrategyOrchestrator(database),
    );
    return { business, extraction, reviewService };
  }

  async function startReview(
    setup: Awaited<ReturnType<typeof extractedBusiness>>,
    reviewerId = "David",
  ) {
    const session = await setup.reviewService.startReview({
      businessId: setup.business.id,
      extractionRunId: setup.extraction.run.id,
      reviewerId,
    });
    const details = await setup.reviewService.getReview(session.id, setup.business.id);
    return {
      session,
      details,
      proposals: new Map(details.proposals.map((proposal) => [proposal.proposalRef, proposal])),
    };
  }

  it("starts review only for a SUCCEEDED extraction and keeps one session per run", async () => {
    const business = await new BusinessService(foundationRepository).create({
      name: `Review status test ${crypto.randomUUID()}`,
    });
    const running = await extractionRepository.createRun({
      businessId: business.id,
      rawIntakeText: baslonMessyIntake,
      sourceMetadata: {},
      promptVersion: "evidence_extractor_v1",
      provider: "review-test",
      model: "fake-v1",
      modelConfiguration: {},
    });
    const service = new EvidenceReviewService(
      reviewRepository,
      createStrategyOrchestrator(database),
    );
    await expect(service.startReview({
      businessId: business.id,
      extractionRunId: running.id,
      reviewerId: "David",
    })).rejects.toThrow("Only a SUCCEEDED");

    const setup = await extractedBusiness();
    const first = await startReview(setup);
    const repeated = await startReview(setup);
    expect(repeated.session.id).toBe(first.session.id);
    await expect(startReview(setup, "Another reviewer"))
      .rejects.toThrow("different reviewer");
  });

  it("applies Claim decisions with correction limits, audit, and idempotency", async () => {
    const setup = await extractedBusiness();
    const { session, proposals } = await startReview(setup);
    const claim = proposals.get("claim_1")!;
    const correctedClaim = proposals.get("claim_2")!;

    const accepted = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: claim.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    expect(accepted).toMatchObject({
      decision: "ACCEPTED",
      canonicalEntityType: "claim",
      reviewedPayload: null,
      reviewedAt: expect.any(Date),
    });
    const repeated = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: claim.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    expect(repeated.id).toBe(accepted.id);
    expect((await database.select({ value: count() }).from(claims)
      .where(eq(claims.businessId, setup.business.id)))[0].value).toBe(1);
    await expect(setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: claim.id,
      reviewerId: "David",
      decision: "REJECTED",
    })).rejects.toThrow("conflicting review decision");

    for (const prohibited of ["fact", "decision"]) {
      await expect(setup.reviewService.reviewProposal({
        businessId: setup.business.id,
        reviewSessionId: session.id,
        proposalId: correctedClaim.id,
        reviewerId: "David",
        decision: "CORRECTED",
        correctedPayload: { claimType: prohibited },
      })).rejects.toThrow();
    }
    await expect(reviewRepository.applyDecision({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: correctedClaim.id,
      reviewerId: "David",
      decision: "ACCEPTED",
      reviewedPayload: null,
      canonical: {
        type: "claim",
        values: {
          businessId: setup.business.id,
          statement: "Repository bypass must not create a fact",
          claimType: "fact",
          subjectArea: "test",
          confidenceLevel: "high",
          confidenceBasis: {
            factAdmission: {
              actorType: "human",
              supportingEvidenceIds: [crypto.randomUUID()],
            },
          },
          sourceType: "test",
        },
      },
    })).rejects.toThrow("cannot create fact or decision");
    const originalPayload = structuredClone(correctedClaim.structuredPayload);
    const corrected = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: correctedClaim.id,
      reviewerId: "David",
      decision: "CORRECTED",
      correctedPayload: {
        statement: "£7.5k+ is a commercially unvalidated target engagement.",
        confidenceLevel: "medium-low",
      },
    });
    expect(corrected.reviewedPayload).toMatchObject({
      statement: "£7.5k+ is a commercially unvalidated target engagement.",
      claimType: "hypothesis",
    });
    const [unchangedProposal] = await database.select().from(evidenceProposals)
      .where(eq(evidenceProposals.id, correctedClaim.id));
    expect(unchangedProposal.structuredPayload).toEqual(originalPayload);
    await expect(database.update(evidenceProposals)
      .set({ structuredPayload: { tampered: true } })
      .where(eq(evidenceProposals.id, correctedClaim.id))).rejects.toThrow();
  });

  it("enforces Evidence numeric provenance and immutable source provenance", async () => {
    const setup = await extractedBusiness();
    const { session, proposals } = await startReview(setup);
    const proposal = proposals.get("evidence_1")!;

    await expect(setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposal.id,
      reviewerId: "David",
      decision: "CORRECTED",
      correctedPayload: { valueNumeric: 81000 },
    })).rejects.toThrow("not explicitly present");
    const reviewed = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposal.id,
      reviewerId: "David",
      decision: "CORRECTED",
      correctedPayload: {
        statement: "Founder records report approximately £80k annual revenue.",
        valueNumeric: 80000,
        reliabilityLevel: "medium",
      },
    });
    const [canonical] = await database.select().from(evidence)
      .where(eq(evidence.id, reviewed.canonicalEntityId!));
    expect(canonical).toMatchObject({
      valueNumeric: "80000.0000",
      sourceReference: "Baslon Business #001 messy intake",
      sourceMetadata: expect.objectContaining({
        sourceExcerpt: "about £80k over the last year",
        evidenceReview: expect.objectContaining({ reviewerId: "David" }),
      }),
    });
    expect(canonical.rawPayload).toMatchObject({
      sourceExcerpt: "about £80k over the last year",
      proposalId: proposal.id,
    });
  });

  it("requires accepted dependencies for Metrics and relationships", async () => {
    const setup = await extractedBusiness();
    const { session, proposals } = await startReview(setup);
    const metric = proposals.get("metric_1")!;
    const relationship = proposals.get("relationship_1")!;

    for (const proposal of [metric, relationship]) {
      await expect(setup.reviewService.reviewProposal({
        businessId: setup.business.id,
        reviewSessionId: session.id,
        proposalId: proposal.id,
        reviewerId: "David",
        decision: "ACCEPTED",
      })).rejects.toThrow("must be accepted first");
    }

    const evidenceReview = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposals.get("evidence_1")!.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposals.get("claim_1")!.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    const metricReview = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: metric.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    const [canonicalMetric] = await database.select().from(metrics)
      .where(eq(metrics.id, metricReview.canonicalEntityId!));
    expect(canonicalMetric.sourceEvidenceId).toBe(evidenceReview.canonicalEntityId);
    const relationshipReview = await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: relationship.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    expect(relationshipReview.canonicalReference).toMatchObject({
      evidenceId: evidenceReview.canonicalEntityId,
      relationshipType: "supports",
    });
  });

  it("rejects corrected Metric calculations not present in the source", async () => {
    const setup = await extractedBusiness();
    const { session, proposals } = await startReview(setup);
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposals.get("evidence_1")!.id,
      reviewerId: "David",
      decision: "ACCEPTED",
    });
    await expect(setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposals.get("metric_1")!.id,
      reviewerId: "David",
      decision: "CORRECTED",
      correctedPayload: { numericValue: 81000 },
    })).rejects.toThrow("not explicitly present");
  });

  it("refuses completion when a recorded accepted dependency has no canonical endpoints", async () => {
    const setup = await extractedBusiness();
    const { session, details } = await startReview(setup);
    await database.insert(proposalReviews).values(details.proposals.map((proposal) => ({
      reviewSessionId: session.id,
      proposalId: proposal.id,
      extractionRunId: setup.extraction.run.id,
      businessId: setup.business.id,
      decision: proposal.proposalType === "claim_evidence" ? "ACCEPTED" as const : "REJECTED" as const,
      reviewedPayload: null,
      canonicalEntityType: proposal.proposalType === "claim_evidence" ? "claim_evidence" as const : null,
      canonicalReference: {},
    })));
    const orchestrator = createStrategyOrchestrator(database);
    await orchestrator.transition({
      businessId: setup.business.id, event: "START_INTAKE", actorType: "human", actorId: "David",
    });
    await orchestrator.transition({
      businessId: setup.business.id, event: "SUBMIT_INTAKE", actorType: "human", actorId: "David",
    });
    await orchestrator.transition({
      businessId: setup.business.id, event: "PROCESS_EVIDENCE", actorType: "system",
      actorId: "evidence-extraction-service",
    });

    await expect(setup.reviewService.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    })).rejects.toThrow("missing canonical endpoints");
    expect((await database.select({ value: count() }).from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, setup.business.id)))[0].value).toBe(0);
  });

  it("completes the Baslon #001 review journey once and exposes Evidence State", async () => {
    const output = structuredClone(baslonExtractionOutput);
    output.claims.push({
      proposalRef: "claim_4",
      statement: "The founder wants to work approximately 30 hours per week.",
      claimType: "observation",
      subjectArea: "founder_fit",
      confidenceLevel: "medium",
      confidenceScore: 0.7,
      confidenceBasis: { basis: "Founder intake" },
      sourceType: "business_intake",
    });
    const setup = await extractedBusiness(output);
    const { session, proposals } = await startReview(setup);

    await expect(setup.reviewService.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    })).rejects.toThrow("Every proposal");

    const acceptedClaim = await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("claim_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("claim_2")!.id, reviewerId: "David", decision: "CORRECTED",
      correctedPayload: { statement: "£7.5k+ remains an unvalidated commercial hypothesis." },
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("claim_3")!.id, reviewerId: "David", decision: "UNRESOLVED",
      reason: "Repeat revenue share remains unknown",
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("claim_4")!.id, reviewerId: "David", decision: "REJECTED",
      reason: "Not required in the current evidence state",
    });
    const acceptedEvidence = await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("evidence_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("metric_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });
    await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("relationship_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });

    const [acceptedCanonicalClaim] = await database.select().from(claims)
      .where(eq(claims.id, acceptedClaim.canonicalEntityId!));
    expect(acceptedCanonicalClaim.claimType).toBe("management_belief");
    const fact = await new FactAdmissionService(new FactAdmissionRepository(database)).promoteToFact({
      currentClaimId: acceptedCanonicalClaim.id,
      claim: {
        businessId: setup.business.id,
        statement: "Human review admits approximately £80k annual revenue as fact.",
        subjectArea: "economics",
        confidenceLevel: "high",
        confidenceBasis: { basis: "Explicit human review with selected Evidence" },
        sourceType: "human_fact_admission",
      },
      supportingEvidenceIds: [acceptedEvidence.canonicalEntityId!],
      authority: deriveHumanAuthority({ actorType: "human", actorId: "David" }),
    });
    expect(fact.claimType).toBe("fact");

    const orchestrator = createStrategyOrchestrator(database);
    await orchestrator.transition({
      businessId: setup.business.id, event: "START_INTAKE", actorType: "human", actorId: "David",
    });
    await orchestrator.transition({
      businessId: setup.business.id, event: "SUBMIT_INTAKE", actorType: "human", actorId: "David",
    });
    await orchestrator.transition({
      businessId: setup.business.id, event: "PROCESS_EVIDENCE", actorType: "system",
      actorId: "evidence-extraction-service",
    });

    const completed = await setup.reviewService.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    });
    expect(completed.session).toMatchObject({
      status: "COMPLETED",
      resultingSnapshotId: completed.snapshot.id,
      completedAt: expect.any(Date),
    });
    const repeated = await setup.reviewService.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    });
    expect(repeated.snapshot.id).toBe(completed.snapshot.id);
    expect((await database.select({ value: count() }).from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, setup.business.id)))[0].value).toBe(1);
    expect((await foundationRepository.getWorkflow(setup.business.id))?.state)
      .toBe("EVIDENCE_READY");

    const snapshot = completed.snapshot.snapshotData as {
      claims: Array<{ statement: string; claimType: string }>;
      evidence: Array<{ id: string }>;
      metrics: Array<{ metricKey: string }>;
    };
    expect(snapshot.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimType: "fact" }),
      expect.objectContaining({ statement: "£7.5k+ remains an unvalidated commercial hypothesis." }),
    ]));
    expect(snapshot.claims).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: output.claims[2].statement }),
      expect.objectContaining({ statement: output.claims[3].statement }),
    ]));
    expect(snapshot.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: acceptedEvidence.canonicalEntityId }),
    ]));
    expect(snapshot.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricKey: "annual_revenue" }),
    ]));

    const evidenceState = await new EvidenceStateService(reviewRepository)
      .getCurrent(setup.business.id);
    expect(evidenceState.claims.facts).toHaveLength(1);
    expect(evidenceState.claims.hypotheses).toEqual([
      expect.objectContaining({
        statement: "£7.5k+ remains an unvalidated commercial hypothesis.",
        lineage: expect.objectContaining({ proposal: expect.any(Object) }),
      }),
    ]);
    expect(evidenceState.claims.unknowns).toEqual([]);
    expect(evidenceState.evidence).toHaveLength(1);
    expect(evidenceState.metrics).toHaveLength(1);
    const reviews = await database.select().from(proposalReviews)
      .where(eq(proposalReviews.reviewSessionId, session.id));
    expect(reviews).toHaveLength(7);
    expect(reviews.find((review) => review.decision === "UNRESOLVED")?.canonicalEntityId)
      .toBeNull();
  });

  it("persists no canonical state for REJECTED or UNRESOLVED proposals", async () => {
    const setup = await extractedBusiness();
    const { session, proposals } = await startReview(setup);
    for (const [proposalRef, decision] of [
      ["claim_1", "REJECTED"],
      ["claim_2", "UNRESOLVED"],
    ] as const) {
      const review = await setup.reviewService.reviewProposal({
        businessId: setup.business.id,
        reviewSessionId: session.id,
        proposalId: proposals.get(proposalRef)!.id,
        reviewerId: "David",
        decision,
      });
      expect(review).toMatchObject({
        canonicalEntityType: null,
        canonicalEntityId: null,
      });
    }
    expect((await database.select({ value: count() }).from(claims)
      .where(eq(claims.businessId, setup.business.id)))[0].value).toBe(0);
  });

});
