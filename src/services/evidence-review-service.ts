import { applicationProvenance, REVIEW_CARD_VERSION } from "@/domain/review-card";
import {
  claimEvidenceProposalSchema,
  claimProposalSchema,
  readStoredEvidenceProposal,
  readStoredMetricProposal,
  reviewableEvidenceProposalSchema,
  reviewableMetricProposalSchema,
} from "@/ai/evidence-extractor/contracts";
import {
  EvidenceExtractionBusinessRuleError,
  numericValueIsExplicit,
} from "@/ai/evidence-extractor/validation";
import {
  claimCorrectionSchema,
  completeEvidenceReviewSchema,
  evidenceCorrectionSchema,
  metricCorrectionSchema,
  relationshipCorrectionSchema,
  reviewProposalSchema,
  startEvidenceReviewSchema,
} from "@/domain/evidence-review";
import type {
  CanonicalApplication,
  EvidenceReviewRepository,
} from "@/repositories/evidence-review-repository";
import type { StrategyOrchestrator } from "@/strategy/orchestrator";
import { isDeepStrictEqual } from "node:util";

type ReviewDetails = Awaited<ReturnType<EvidenceReviewRepository["getSessionDetails"]>>;

function reviewLineage(details: ReviewDetails, proposalId: string) {
  return {
    evidenceReview: {
      reviewSessionId: details.session.id,
      extractionRunId: details.session.extractionRunId,
      proposalId,
      reviewerId: details.session.reviewerId,
      // Records that the complete canonical object was shown before the decision (M4-11).
      reviewCardVersion: REVIEW_CARD_VERSION,
    },
  };
}

/** Provenance of the reviewed run, owned by the application rather than the model (N-1). */
function runProvenance(details: ReviewDetails) {
  if (!details.run || details.run.businessId !== details.session.businessId) {
    throw new Error("The reviewed extraction run must belong to the same Business");
  }
  return applicationProvenance(details.run);
}

function acceptedReviewForRef(
  details: ReviewDetails,
  proposalRef: string,
  expectedType: "claim" | "evidence",
) {
  const proposal = details.proposals.find((item) => item.proposalRef === proposalRef);
  if (!proposal || proposal.proposalType !== expectedType) {
    throw new Error(`${expectedType} dependency ${proposalRef} is not part of this review`);
  }
  const review = details.reviews.find((item) => item.proposalId === proposal.id);
  if (
    !review
    || !["ACCEPTED", "CORRECTED"].includes(review.decision)
    || review.canonicalEntityType !== expectedType
    || !review.canonicalEntityId
  ) {
    throw new Error(`${expectedType} dependency ${proposalRef} must be accepted first`);
  }
  return review;
}

/**
 * Human-reviewed values and range bounds must still be stated in the original
 * source excerpt. The precision classification itself is the reviewer's
 * judgement and is not wording-checked.
 */
/**
 * The precision the linked source Evidence ended human review with: its
 * correction if corrected, otherwise its stored proposal. Qualitative Evidence
 * (no value and no range) carries no numeric precision to match.
 */
function reviewedSourceEvidencePrecision(details: ReviewDetails, evidenceRef: string) {
  const review = acceptedReviewForRef(details, evidenceRef, "evidence");
  const proposal = details.proposals.find((item) => item.id === review.proposalId)!;
  const evidence = readStoredEvidenceProposal(review.reviewedPayload ?? proposal.structuredPayload);
  const numeric = evidence.valueNumeric !== null || evidence.valueLower !== null;
  return numeric ? evidence.valuePrecision ?? "unspecified" : null;
}

function requireGroundedNumbers(proposalRef: string, numbers: Array<number | null>, sourceExcerpt: string) {
  for (const value of numbers) {
    if (value !== null && !numericValueIsExplicit(value, sourceExcerpt)) {
      throw new EvidenceExtractionBusinessRuleError([
        `${proposalRef} reviewed numeric value ${value} is not explicitly present in its source excerpt`,
      ]);
    }
  }
}

function requireMaterialCorrection(original: unknown, reviewed: unknown): void {
  if (isDeepStrictEqual(original, reviewed)) {
    throw new Error(
      "No changes detected. Use Accept, or edit at least one field before saving a correction.",
    );
  }
}

export class EvidenceReviewService {
  constructor(
    private readonly repository: EvidenceReviewRepository,
    private readonly orchestrator: StrategyOrchestrator,
  ) {}

  async startReview(input: unknown) {
    const parsed = startEvidenceReviewSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    return this.repository.startSession(parsed);
  }

  getReview(sessionId: string, businessId: string) {
    return this.repository.getSessionDetails(sessionId, businessId);
  }

  getReviewByRun(extractionRunId: string, businessId: string) {
    return this.repository.getSessionByRun(extractionRunId, businessId);
  }

  getExtraction(extractionRunId: string, businessId: string) {
    return this.repository.getExtractionDetails(extractionRunId, businessId);
  }

  getWorkflowState(businessId: string) {
    return this.repository.getWorkflowState(businessId);
  }

  async reviewProposal(input: unknown) {
    const parsed = reviewProposalSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const details = await this.repository.getSessionDetails(
      parsed.reviewSessionId,
      parsed.businessId,
    );
    if (details.session.status !== "OPEN") throw new Error("Evidence Review Session is completed");
    if (details.session.reviewerId !== parsed.reviewerId) {
      throw new Error("Reviewer does not match the Evidence Review Session");
    }
    const proposal = details.proposals.find((item) => item.id === parsed.proposalId);
    if (!proposal) throw new Error("Proposal does not belong to the Review Session");

    let reviewedPayload: Record<string, unknown> | null = null;
    let canonical: CanonicalApplication = { type: "none" };
    const applies = parsed.decision === "ACCEPTED" || parsed.decision === "CORRECTED";

    if (proposal.proposalType === "claim" && applies) {
      const original = claimProposalSchema.parse(proposal.structuredPayload);
      const reviewed = parsed.decision === "CORRECTED"
        ? claimProposalSchema.parse({
          ...original,
          ...claimCorrectionSchema.parse(parsed.correctedPayload),
        })
        : original;
      if (parsed.decision === "CORRECTED") requireMaterialCorrection(original, reviewed);
      reviewedPayload = parsed.decision === "CORRECTED" ? reviewed : null;
      canonical = {
        type: "claim",
        values: {
          businessId: parsed.businessId,
          statement: reviewed.statement,
          claimType: reviewed.claimType,
          subjectArea: reviewed.subjectArea,
          confidenceLevel: reviewed.confidenceLevel,
          confidenceScore: reviewed.confidenceScore?.toString(),
          confidenceBasis: {
            ...reviewed.confidenceBasis,
            ...reviewLineage(details, proposal.id),
          },
          sourceType: runProvenance(details).sourceType,
        },
      };
    } else if (proposal.proposalType === "evidence" && applies) {
      const original = readStoredEvidenceProposal(proposal.structuredPayload);
      const correction = parsed.decision === "CORRECTED"
        ? evidenceCorrectionSchema.parse(parsed.correctedPayload)
        : undefined;
      const { sourceNotes, ...evidenceCorrection } = correction ?? {};
      const reviewed = correction
        ? reviewableEvidenceProposalSchema.parse({
          ...original,
          ...evidenceCorrection,
          sourceMetadata: sourceNotes === undefined
            ? original.sourceMetadata
            : { ...original.sourceMetadata, notes: sourceNotes },
        })
        : original;
      const provenance = runProvenance(details);
      if (parsed.decision === "CORRECTED") requireMaterialCorrection(original, reviewed);
      requireGroundedNumbers(
        proposal.proposalRef,
        [reviewed.valueNumeric, reviewed.valueLower, reviewed.valueUpper],
        original.sourceExcerpt,
      );
      reviewedPayload = parsed.decision === "CORRECTED" ? reviewed : null;
      canonical = {
        type: "evidence",
        values: {
          businessId: parsed.businessId,
          evidenceType: reviewed.evidenceType,
          statement: reviewed.statement,
          valueNumeric: reviewed.valueNumeric?.toString(),
          valuePrecision: reviewed.valuePrecision ?? "unspecified",
          valueLower: reviewed.valueLower?.toString(),
          valueUpper: reviewed.valueUpper?.toString(),
          valueText: reviewed.valueText,
          unit: reviewed.unit,
          periodStart: reviewed.periodStart,
          periodEnd: reviewed.periodEnd,
          // Provenance comes from the run; only the AI-proposed notes come from the proposal.
          sourceType: provenance.sourceType,
          sourceReference: provenance.sourceReference,
          sourceMetadata: {
            suppliedBy: provenance.suppliedBy,
            notes: reviewed.sourceMetadata.notes,
            sourceExcerpt: original.sourceExcerpt,
            ...reviewLineage(details, proposal.id),
          },
          reliabilityLevel: reviewed.reliabilityLevel,
          reliabilityScore: reviewed.reliabilityScore?.toString(),
          directnessLevel: reviewed.directnessLevel,
          recencyLevel: reviewed.recencyLevel,
          rawPayload: {
            excerpt: original.sourceExcerpt,
            sourceExcerpt: original.sourceExcerpt,
            extractionRunId: details.session.extractionRunId,
            proposalId: proposal.id,
          },
          materiality: reviewed.materiality,
        },
      };
    } else if (proposal.proposalType === "metric" && applies) {
      const original = readStoredMetricProposal(proposal.structuredPayload);
      const reviewed = parsed.decision === "CORRECTED"
        ? reviewableMetricProposalSchema.parse({
          ...original,
          ...metricCorrectionSchema.parse(parsed.correctedPayload),
        })
        : original;
      if (parsed.decision === "CORRECTED") requireMaterialCorrection(original, reviewed);
      requireGroundedNumbers(
        proposal.proposalRef,
        [reviewed.numericValue, reviewed.numericLower, reviewed.numericUpper],
        original.sourceExcerpt,
      );
      const sourceEvidenceId = reviewed.sourceEvidenceRef
        ? acceptedReviewForRef(details, reviewed.sourceEvidenceRef, "evidence").canonicalEntityId!
        : undefined;
      // A Metric taken from numeric Evidence must not persist a different
      // precision from that Evidence; values may still differ.
      const sourcePrecision = reviewed.sourceEvidenceRef
        ? reviewedSourceEvidencePrecision(details, reviewed.sourceEvidenceRef)
        : null;
      if (sourcePrecision !== null && sourcePrecision !== reviewed.numericPrecision) {
        throw new EvidenceExtractionBusinessRuleError([
          `${proposal.proposalRef} precision ${reviewed.numericPrecision} must match its source Evidence ${reviewed.sourceEvidenceRef} precision ${sourcePrecision}`,
        ]);
      }
      reviewedPayload = parsed.decision === "CORRECTED" ? reviewed : null;
      canonical = {
        type: "metric",
        values: {
          businessId: parsed.businessId,
          metricKey: reviewed.metricKey,
          metricLabel: reviewed.metricLabel,
          numericValue: reviewed.numericValue?.toString(),
          numericPrecision: reviewed.numericPrecision,
          numericLower: reviewed.numericLower?.toString(),
          numericUpper: reviewed.numericUpper?.toString(),
          unit: reviewed.unit,
          periodStart: reviewed.periodStart,
          periodEnd: reviewed.periodEnd,
          dimensionData: {
            ...reviewed.dimensionData,
            ...reviewLineage(details, proposal.id),
          },
          sourceEvidenceId,
        },
      };
    } else if (proposal.proposalType === "claim_evidence" && applies) {
      const original = claimEvidenceProposalSchema.parse(proposal.structuredPayload);
      const reviewed = parsed.decision === "CORRECTED"
        ? claimEvidenceProposalSchema.parse({
          ...original,
          ...relationshipCorrectionSchema.parse(parsed.correctedPayload),
        })
        : original;
      if (parsed.decision === "CORRECTED") requireMaterialCorrection(original, reviewed);
      const claimReview = acceptedReviewForRef(details, original.claimRef, "claim");
      const evidenceReview = acceptedReviewForRef(details, original.evidenceRef, "evidence");
      reviewedPayload = parsed.decision === "CORRECTED" ? reviewed : null;
      canonical = {
        type: "claim_evidence",
        values: {
          businessId: parsed.businessId,
          claimId: claimReview.canonicalEntityId!,
          evidenceId: evidenceReview.canonicalEntityId!,
          relationshipType: reviewed.relationshipType,
          strengthScore: reviewed.strengthScore?.toString(),
        },
      };
    }

    return this.repository.applyDecision({
      businessId: parsed.businessId,
      reviewSessionId: parsed.reviewSessionId,
      proposalId: parsed.proposalId,
      reviewerId: parsed.reviewerId,
      decision: parsed.decision,
      reviewedPayload,
      reason: parsed.reason,
      canonical,
    });
  }

  async completeReview(input: unknown) {
    const parsed = completeEvidenceReviewSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    const result = await this.repository.completeSession(parsed);
    if (result.workflowState === "EVIDENCE_PROCESSING") {
      try {
        await this.orchestrator.transition({
          businessId: parsed.businessId,
          event: "MARK_ANALYSIS_COMPLETE",
          actorType: "system",
          actorId: "evidence-review-service",
          reason: "Human Evidence Review completed",
          metadata: {
            reviewSessionId: parsed.reviewSessionId,
            reviewerId: parsed.reviewerId,
          },
        });
      } catch (error) {
        if (await this.repository.getWorkflowState(parsed.businessId) !== "EVIDENCE_READY") {
          throw error;
        }
      }
    }
    return result;
  }
}
