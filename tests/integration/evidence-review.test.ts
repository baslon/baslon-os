import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../helpers/pglite-migrations";
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
  evidenceReviewSessions,
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
import { StrategyOrchestrator } from "@/strategy/orchestrator";
import { FactAdmissionService } from "@/services/fact-admission-service";
import {
  baslonBusiness,
  baslonExtractionOutput,
  baslonMessyIntake,
  legacyEvidenceProposal,
  legacyMetricProposal,
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
    await applyMigrations(client);
    database = drizzle(client, { schema: await import("@/db/schema") }) as unknown as Database;
    foundationRepository = new FoundationRepository(database);
    extractionRepository = new EvidenceExtractionRepository(database);
    reviewRepository = new EvidenceReviewRepository(database);
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  async function extractedBusiness(
    output: EvidenceExtractionOutput = baslonExtractionOutput,
    rawIntakeText = baslonMessyIntake,
  ) {
    const business = await new BusinessService(foundationRepository).create({
      ...baslonBusiness,
      name: `${baslonBusiness.name} ${crypto.randomUUID()}`,
    });
    const orchestrator = createStrategyOrchestrator(database);
    await orchestrator.transition({ businessId: business.id, event: "START_INTAKE", actorType: "human" });
    await orchestrator.transition({ businessId: business.id, event: "SUBMIT_INTAKE", actorType: "human" });
    await orchestrator.transition({ businessId: business.id, event: "PROCESS_EVIDENCE", actorType: "system" });
    const extraction = await new EvidenceExtractionService(
      extractionRepository,
      new FakeModel({ output, rawOutput: output }),
    ).extract({
      businessId: business.id,
      rawIntakeText,
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

  it("rejects review of a superseded extraction run", async () => {
    const setup = await extractedBusiness();
    const newer = await new EvidenceExtractionService(
      extractionRepository,
      new FakeModel({
        output: { claims: [], evidence: [], metrics: [], relationships: [] },
        rawOutput: {},
      }),
    ).extract({
      businessId: setup.business.id,
      rawIntakeText: "A later extraction source.",
      sourceType: "business_intake",
    });
    await expect(startReview(setup)).rejects.toThrow("current Evidence Extraction Run");
    await expect(setup.reviewService.startReview({
      businessId: setup.business.id,
      extractionRunId: newer.run.id,
      reviewerId: "David",
    })).resolves.toMatchObject({ extractionRunId: newer.run.id });
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
      correctedPayload: {
        statement: "Founder notes indicate approximately £80k annual revenue.",
        reliabilityLevel: "medium",
      },
    })).rejects.toThrow("No changes detected");
    await expect(setup.reviewService.reviewProposal({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      proposalId: proposal.id,
      reviewerId: "David",
      decision: "CORRECTED",
      correctedPayload: { sourceExcerpt: "rewritten provenance" },
    })).rejects.toThrow();

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
      // Provenance comes from the extraction run, not the model's echoed reference (N-1).
      sourceReference: "Baslon #001 review fixture",
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

  it("reviews, corrects and persists numeric precision and range bounds into the snapshot", async () => {
    const rawIntakeText = "Revenue was about £80k over the last year. We run 10–15 projects a year, sometimes 20.";
    const output = structuredClone(baslonExtractionOutput);
    output.claims = [];
    output.relationships = [];
    output.evidence.push({
      ...output.evidence[0], proposalRef: "evidence_2",
      statement: "The business runs 10–15 projects a year.", valueText: "10–15 projects a year", unit: "projects",
      valueNumeric: null, valuePrecision: "range", valueLower: 10, valueUpper: 15,
      sourceExcerpt: "10–15 projects a year, sometimes 20", rawPayload: { excerpt: "10–15 projects a year" },
    });
    output.metrics.push({
      ...output.metrics[0], proposalRef: "metric_2", metricKey: "annual_projects", metricLabel: "Projects per year",
      unit: "projects", numericValue: null, numericPrecision: "range", numericLower: 10, numericUpper: 15,
      sourceEvidenceRef: "evidence_2", sourceExcerpt: "10–15 projects a year, sometimes 20",
    });
    const setup = await extractedBusiness(output, rawIntakeText);
    const { session, proposals } = await startReview(setup);
    const review = (proposalRef: string, decision: "ACCEPTED" | "CORRECTED", correctedPayload?: Record<string, unknown>) =>
      setup.reviewService.reviewProposal({
        businessId: setup.business.id, reviewSessionId: session.id,
        proposalId: proposals.get(proposalRef)!.id, reviewerId: "David", decision, correctedPayload,
      });

    // The reviewer sees the proposed precision on the stored proposal.
    expect(proposals.get("evidence_1")!.structuredPayload).toMatchObject({ valuePrecision: "approximate" });
    expect(proposals.get("evidence_2")!.structuredPayload).toMatchObject({ valuePrecision: "range", valueLower: 10, valueUpper: 15 });

    // Corrected numbers must still be grounded, and ranges must stay well-formed.
    await expect(review("evidence_2", "CORRECTED", { valueUpper: 25 })).rejects.toThrow("not explicitly present");
    await expect(review("evidence_2", "CORRECTED", { valueLower: 20, valueUpper: 15 })).rejects.toThrow();
    await expect(review("evidence_2", "CORRECTED", { valuePrecision: "exact" })).rejects.toThrow();

    // A human may change precision without a wording check, and correct range bounds.
    const estimated = await review("evidence_1", "CORRECTED", { valuePrecision: "estimate" });
    const corrected = await review("evidence_2", "CORRECTED", { valueUpper: 20 });
    const metric1 = await review("metric_1", "CORRECTED", { numericPrecision: "estimate" });
    const metric2 = await review("metric_2", "CORRECTED", { numericUpper: 20 });

    const [estimate] = await database.select().from(evidence).where(eq(evidence.id, estimated.canonicalEntityId!));
    const [range] = await database.select().from(evidence).where(eq(evidence.id, corrected.canonicalEntityId!));
    expect(estimate).toMatchObject({ valueNumeric: "80000.0000", valuePrecision: "estimate", valueLower: null, valueUpper: null });
    expect(range).toMatchObject({ valueNumeric: null, valuePrecision: "range", valueLower: "10.0000", valueUpper: "20.0000" });
    const [estimateMetric] = await database.select().from(metrics).where(eq(metrics.id, metric1.canonicalEntityId!));
    const [rangeMetric] = await database.select().from(metrics).where(eq(metrics.id, metric2.canonicalEntityId!));
    expect(estimateMetric).toMatchObject({ numericValue: "80000.0000", numericPrecision: "estimate" });
    expect(rangeMetric).toMatchObject({
      numericValue: null, numericPrecision: "range", numericLower: "10.0000", numericUpper: "20.0000",
      sourceEvidenceId: range.id,
    });

    const { snapshot } = await setup.reviewService.completeReview({
      businessId: setup.business.id, reviewSessionId: session.id, reviewerId: "David",
    });
    const data = snapshot.snapshotData as { evidence: Array<Record<string, unknown>>; metrics: Array<Record<string, unknown>> };
    expect(data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: estimate.id, valuePrecision: "estimate" }),
      expect.objectContaining({ id: range.id, valueNumeric: null, valuePrecision: "range", valueLower: "10.0000", valueUpper: "20.0000" }),
    ]));
    expect(data.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rangeMetric.id, numericValue: null, numericPrecision: "range", numericUpper: "20.0000" }),
    ]));
  });

  describe("linked Evidence and Metric precision at human review (H1)", () => {
    const rawIntakeText = [
      "Revenue was about £80k over the last year.",
      "We run 10–15 projects a year, sometimes 20.",
      "We have 12 staff.",
      "We do not track churn.",
    ].join(" ");

    /** Linked pairs: approximate (1), range (2), exact (3); an unlinked Metric (4); a Metric on qualitative Evidence (5). */
    function linkedOutput(): EvidenceExtractionOutput {
      const output = structuredClone(baslonExtractionOutput);
      const [baseEvidence] = output.evidence;
      const [baseMetric] = output.metrics;
      output.claims = [];
      output.relationships = [];
      output.evidence.push(
        {
          ...baseEvidence, proposalRef: "evidence_2", statement: "The business runs 10–15 projects a year.",
          valueText: "10–15 projects", unit: "projects", valueNumeric: null, valuePrecision: "range",
          valueLower: 10, valueUpper: 15, sourceExcerpt: "10–15 projects a year, sometimes 20",
        },
        {
          ...baseEvidence, proposalRef: "evidence_3", statement: "The business has 12 staff.",
          valueText: "12 staff", unit: "staff", valueNumeric: 12, valuePrecision: "exact",
          valueLower: null, valueUpper: null, sourceExcerpt: "We have 12 staff.",
        },
        {
          ...baseEvidence, proposalRef: "evidence_5", statement: "Churn is not tracked.",
          valueText: null, unit: null, valueNumeric: null, valuePrecision: null,
          valueLower: null, valueUpper: null, sourceExcerpt: "We do not track churn.",
        },
      );
      output.metrics.push(
        {
          ...baseMetric, proposalRef: "metric_2", metricKey: "annual_projects", metricLabel: "Projects per year",
          unit: "projects", numericValue: null, numericPrecision: "range", numericLower: 10, numericUpper: 15,
          sourceEvidenceRef: "evidence_2", sourceExcerpt: "10–15 projects a year, sometimes 20",
        },
        {
          ...baseMetric, proposalRef: "metric_3", metricKey: "staff", metricLabel: "Staff",
          unit: "staff", numericValue: 12, numericPrecision: "exact", numericLower: null, numericUpper: null,
          sourceEvidenceRef: "evidence_3", sourceExcerpt: "We have 12 staff.",
        },
        {
          ...baseMetric, proposalRef: "metric_4", metricKey: "headcount", metricLabel: "Headcount",
          unit: "staff", numericValue: 12, numericPrecision: "exact", numericLower: null, numericUpper: null,
          sourceEvidenceRef: null, sourceExcerpt: "We have 12 staff.",
        },
        {
          ...baseMetric, proposalRef: "metric_5", metricKey: "staff_on_churn", metricLabel: "Staff (churn context)",
          unit: "staff", numericValue: 12, numericPrecision: "exact", numericLower: null, numericUpper: null,
          sourceEvidenceRef: "evidence_5", sourceExcerpt: "We have 12 staff.",
        },
      );
      return output;
    }

    async function linkedReview() {
      const setup = await extractedBusiness(linkedOutput(), rawIntakeText);
      const { session, proposals } = await startReview(setup);
      const review = (proposalRef: string, decision: "ACCEPTED" | "CORRECTED", correctedPayload?: Record<string, unknown>) =>
        setup.reviewService.reviewProposal({
          businessId: setup.business.id, reviewSessionId: session.id,
          proposalId: proposals.get(proposalRef)!.id, reviewerId: "David", decision, correctedPayload,
        });
      const canonicalMetric = async (canonicalEntityId: string | null) =>
        (await database.select().from(metrics).where(eq(metrics.id, canonicalEntityId!)))[0];
      const canonicalEvidence = async (canonicalEntityId: string | null) =>
        (await database.select().from(evidence).where(eq(evidence.id, canonicalEntityId!)))[0];
      return { review, canonicalMetric, canonicalEvidence };
    }

    it("accepts a linked Metric whose precision matches its Evidence", async () => {
      const { review, canonicalMetric, canonicalEvidence } = await linkedReview();
      const item = await review("evidence_1", "ACCEPTED");
      const metric = await review("metric_1", "ACCEPTED");
      expect((await canonicalEvidence(item.canonicalEntityId)).valuePrecision).toBe("approximate");
      expect((await canonicalMetric(metric.canonicalEntityId)).numericPrecision).toBe("approximate");
    });

    it("rejects a linked Metric whose precision conflicts with its reviewed Evidence", async () => {
      const { review } = await linkedReview();
      await review("evidence_1", "ACCEPTED");
      await expect(review("metric_1", "CORRECTED", { numericPrecision: "exact" }))
        .rejects.toThrow("metric_1 precision exact must match its source Evidence evidence_1 precision approximate");
      await review("evidence_3", "CORRECTED", { valuePrecision: "estimate" });
      // Accepting the Metric unchanged would persist exact against estimate Evidence.
      await expect(review("metric_3", "ACCEPTED"))
        .rejects.toThrow("metric_3 precision exact must match its source Evidence evidence_3 precision estimate");
    });

    it("accepts correcting a linked pair to estimate", async () => {
      const { review, canonicalMetric, canonicalEvidence } = await linkedReview();
      const item = await review("evidence_1", "CORRECTED", { valuePrecision: "estimate" });
      const metric = await review("metric_1", "CORRECTED", { numericPrecision: "estimate" });
      expect((await canonicalEvidence(item.canonicalEntityId)).valuePrecision).toBe("estimate");
      expect(await canonicalMetric(metric.canonicalEntityId)).toMatchObject({ numericValue: "80000.0000", numericPrecision: "estimate" });
    });

    it("accepts correcting a linked pair to approximate", async () => {
      const { review, canonicalMetric, canonicalEvidence } = await linkedReview();
      const item = await review("evidence_3", "CORRECTED", { valuePrecision: "approximate" });
      const metric = await review("metric_3", "CORRECTED", { numericPrecision: "approximate" });
      expect((await canonicalEvidence(item.canonicalEntityId)).valuePrecision).toBe("approximate");
      expect(await canonicalMetric(metric.canonicalEntityId)).toMatchObject({ numericValue: "12.0000", numericPrecision: "approximate" });
    });

    it("keeps a linked range consistent without requiring equal bounds", async () => {
      const { review, canonicalMetric, canonicalEvidence } = await linkedReview();
      const item = await review("evidence_2", "CORRECTED", { valueUpper: 20 });
      await expect(review("metric_2", "CORRECTED", { numericPrecision: "exact", numericValue: 15, numericLower: null, numericUpper: null }))
        .rejects.toThrow("metric_2 precision exact must match its source Evidence evidence_2 precision range");
      // Precision must match; the bounds may differ (10–20 Evidence, 10–15 Metric).
      const metric = await review("metric_2", "ACCEPTED");
      expect(await canonicalEvidence(item.canonicalEntityId)).toMatchObject({ valuePrecision: "range", valueUpper: "20.0000" });
      expect(await canonicalMetric(metric.canonicalEntityId)).toMatchObject({
        numericValue: null, numericPrecision: "range", numericLower: "10.0000", numericUpper: "15.0000",
      });
    });

    it("leaves unlinked Metrics and Metrics on qualitative Evidence unaffected", async () => {
      const { review, canonicalMetric } = await linkedReview();
      await review("evidence_3", "CORRECTED", { valuePrecision: "estimate" });
      const unlinked = await review("metric_4", "CORRECTED", { numericPrecision: "approximate" });
      expect((await canonicalMetric(unlinked.canonicalEntityId)).numericPrecision).toBe("approximate");
      await review("evidence_5", "ACCEPTED");
      const onQualitative = await review("metric_5", "CORRECTED", { numericPrecision: "estimate" });
      expect((await canonicalMetric(onQualitative.canonicalEntityId)).numericPrecision).toBe("estimate");
    });
  });

  describe("M4-11 review completeness and N-1 application provenance", () => {
    /** The model writes its own provenance here; none of it may reach canonical state. */
    function modelProvenanceOutput(): EvidenceExtractionOutput {
      const output = structuredClone(baslonExtractionOutput);
      output.claims = output.claims.map((claim) => ({ ...claim, sourceType: "model_invented_channel" }));
      output.evidence = output.evidence.map((item) => ({
        ...item,
        sourceType: "model_invented_channel",
        sourceReference: "Model-written reference",
        sourceMetadata: { suppliedBy: "model_claims_founder", notes: "Accounts not yet checked" },
        rawPayload: { excerpt: "model free text" },
      }));
      return output;
    }

    async function reviewSetup() {
      const setup = await extractedBusiness(modelProvenanceOutput());
      const { session, proposals } = await startReview(setup);
      const review = (proposalRef: string, decision: "ACCEPTED" | "CORRECTED", correctedPayload?: Record<string, unknown>) =>
        setup.reviewService.reviewProposal({
          businessId: setup.business.id, reviewSessionId: session.id,
          proposalId: proposals.get(proposalRef)!.id, reviewerId: "David", decision, correctedPayload,
        });
      return { setup, session, proposals, review };
    }

    it("persists provenance from the extraction run and stamps the review-card version", async () => {
      const { setup, session, proposals, review } = await reviewSetup();
      const acceptedEvidence = await review("evidence_1", "ACCEPTED");
      const acceptedClaim = await review("claim_1", "ACCEPTED");
      const acceptedMetric = await review("metric_1", "ACCEPTED");
      const [item] = await database.select().from(evidence).where(eq(evidence.id, acceptedEvidence.canonicalEntityId!));
      const [claim] = await database.select().from(claims).where(eq(claims.id, acceptedClaim.canonicalEntityId!));
      const [metric] = await database.select().from(metrics).where(eq(metrics.id, acceptedMetric.canonicalEntityId!));
      const lineage = {
        reviewSessionId: session.id,
        extractionRunId: setup.extraction.run.id,
        reviewerId: "David",
        reviewCardVersion: "m4_11_v1",
      };

      // Application-owned provenance: run channel/reference; the model's claims are discarded.
      expect(item).toMatchObject({ sourceType: "business_intake", sourceReference: "Baslon #001 review fixture" });
      expect(item.sourceMetadata).toMatchObject({
        suppliedBy: null,
        notes: "Accounts not yet checked",
        evidenceReview: { ...lineage, proposalId: proposals.get("evidence_1")!.id },
      });
      expect(item.rawPayload).toMatchObject({
        excerpt: "about £80k over the last year",
        extractionRunId: setup.extraction.run.id,
        proposalId: proposals.get("evidence_1")!.id,
      });
      expect(JSON.stringify(item)).not.toMatch(/model_invented_channel|Model-written reference|model_claims_founder|model free text/);
      expect(claim.sourceType).toBe("business_intake");
      expect(claim.confidenceBasis).toMatchObject({ evidenceReview: { ...lineage, proposalId: proposals.get("claim_1")!.id } });
      expect(metric.dimensionData).toMatchObject({ evidenceReview: { ...lineage, proposalId: proposals.get("metric_1")!.id } });

      // Relationships are unaffected: same canonical values as before M4-11.
      const relationship = await review("relationship_1", "ACCEPTED");
      expect(relationship.canonicalReference).toMatchObject({
        claimId: acceptedClaim.canonicalEntityId,
        evidenceId: acceptedEvidence.canonicalEntityId,
        relationshipType: "supports",
      });
    });

    it("persists corrected Evidence type, source notes and Metric dimensions", async () => {
      const { review } = await reviewSetup();
      const correctedEvidence = await review("evidence_1", "CORRECTED", {
        evidenceType: "founder_estimate", sourceNotes: "Founder notes; accounts not reconciled",
      });
      const correctedMetric = await review("metric_1", "CORRECTED", {
        dimensionData: { dimension: "business", value: "Baslon Digital" },
      });
      const [item] = await database.select().from(evidence).where(eq(evidence.id, correctedEvidence.canonicalEntityId!));
      const [metric] = await database.select().from(metrics).where(eq(metrics.id, correctedMetric.canonicalEntityId!));
      expect(item.evidenceType).toBe("founder_estimate");
      expect(item.sourceMetadata).toMatchObject({ notes: "Founder notes; accounts not reconciled", suppliedBy: null });
      expect(correctedEvidence.reviewedPayload).toMatchObject({
        evidenceType: "founder_estimate",
        sourceMetadata: { notes: "Founder notes; accounts not reconciled" },
      });
      expect(metric.dimensionData).toMatchObject({
        dimension: "business", value: "Baslon Digital",
        evidenceReview: { reviewCardVersion: "m4_11_v1" },
      });
    });

    it("rejects correcting provenance, which is not reviewer-editable", async () => {
      const { review } = await reviewSetup();
      await expect(review("evidence_1", "CORRECTED", { sourceReference: "Reviewer-typed reference" })).rejects.toThrow();
      await expect(review("evidence_1", "CORRECTED", { sourceType: "reviewer_channel" })).rejects.toThrow();
      await expect(review("evidence_1", "CORRECTED", { sourceMetadata: { suppliedBy: "reviewer" } })).rejects.toThrow();
    });
  });

  it("accepts a pre-precision stored proposal as unspecified without inferring from its wording", async () => {
    const setup = await extractedBusiness({ claims: [], evidence: [], metrics: [], relationships: [] });
    await database.insert(evidenceProposals).values([
      { extractionRunId: setup.extraction.run.id, businessId: setup.business.id, proposalRef: "evidence_1", proposalType: "evidence", structuredPayload: legacyEvidenceProposal },
      { extractionRunId: setup.extraction.run.id, businessId: setup.business.id, proposalRef: "metric_1", proposalType: "metric", structuredPayload: legacyMetricProposal },
    ]);
    const { session, proposals } = await startReview(setup);
    const accepted = await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("evidence_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });
    const metric = await setup.reviewService.reviewProposal({
      businessId: setup.business.id, reviewSessionId: session.id,
      proposalId: proposals.get("metric_1")!.id, reviewerId: "David", decision: "ACCEPTED",
    });
    // The legacy excerpt says "about £80k", yet nothing is inferred: it stays unspecified.
    const [canonical] = await database.select().from(evidence).where(eq(evidence.id, accepted.canonicalEntityId!));
    const [canonicalMetric] = await database.select().from(metrics).where(eq(metrics.id, metric.canonicalEntityId!));
    expect(canonical).toMatchObject({ valueNumeric: "80000.0000", valuePrecision: "unspecified", valueLower: null, valueUpper: null });
    expect(canonicalMetric).toMatchObject({ numericValue: "80000.0000", numericPrecision: "unspecified" });
    const stored = await database.select().from(evidenceProposals).where(eq(evidenceProposals.id, proposals.get("evidence_1")!.id));
    expect(stored[0].structuredPayload).not.toHaveProperty("valuePrecision");
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

  it("reconciles workflow after snapshot completion survives a transition failure", async () => {
    const setup = await extractedBusiness({ claims: [], evidence: [], metrics: [], relationships: [] });
    const { session } = await startReview(setup);
    const failingOrchestrator = new StrategyOrchestrator({
      assertBusinessActive: async () => undefined,
      getWorkflow: (businessId) => foundationRepository.getWorkflow(businessId),
      commit: async () => { throw new Error("forced workflow transition failure"); },
    });
    const interrupted = new EvidenceReviewService(reviewRepository, failingOrchestrator);
    await expect(interrupted.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    })).rejects.toThrow("forced workflow transition failure");
    const [committedSession] = await database.select().from(evidenceReviewSessions)
      .where(eq(evidenceReviewSessions.id, session.id));
    expect(committedSession).toMatchObject({
      status: "COMPLETED",
      resultingSnapshotId: expect.any(String),
    });
    expect((await foundationRepository.getWorkflow(setup.business.id))?.state)
      .toBe("EVIDENCE_PROCESSING");
    const beforeRetry = await database.select().from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, setup.business.id));
    await setup.reviewService.completeReview({
      businessId: setup.business.id,
      reviewSessionId: session.id,
      reviewerId: "David",
    });
    const afterRetry = await database.select().from(businessStateSnapshots)
      .where(eq(businessStateSnapshots.businessId, setup.business.id));
    expect(afterRetry).toEqual(beforeRetry);
    expect((await foundationRepository.getWorkflow(setup.business.id))?.state)
      .toBe("EVIDENCE_READY");
  });

});
