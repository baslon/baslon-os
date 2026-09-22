"use server";

import { redirect } from "next/navigation";
import {
  getBusinessService,
  getAddInformationService,
  getEvidenceReviewService,
  getFactAdmissionService,
  getInitialIntakeService,
  getEvidenceCoherenceService,
  getGapResolutionService,
  getPhase1DiagnosisService,
} from "@/foundation";
import { parseReferenceLines } from "@/domain/phase1-diagnosis-review-card";
import { deriveHumanAuthority } from "@/domain/server-authority";
import {
  evidenceExtractionFailureTarget,
  initialIntakeUnavailableTarget,
} from "@/domain/intake-retry";
import { InitialIntakeUnavailableError } from "@/domain/initial-intake";

export async function addInformationAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target: string;
  try {
    const service = getAddInformationService();
    const runId = optionalText(formData, "runId");
    const questionId = optionalText(formData, "questionId");
    const result = runId
      ? await service.retry({ businessId, runId })
      : await service.submit({ businessId, rawText: text(formData, "rawText"), sourceReference: optionalText(formData, "sourceReference"), questionId });
    target = `/businesses/${businessId}/reviews/${result.run.id}`;
  } catch {
    const questionId = optionalText(formData, "questionId");
    target = `/businesses/${businessId}/information?${questionId ? `question=${questionId}&` : ""}error=1`;
  }
  redirect(target);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optionalText(formData: FormData, key: string): string | undefined {
  return text(formData, key) || undefined;
}

function nullableText(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

function nullableNumber(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  return value ? Number(value) : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected application error";
}

export async function createBusinessAction(formData: FormData) {
  const business = await getBusinessService().create({
    name: text(formData, "name"),
    legalName: optionalText(formData, "legalName"),
    websiteUrl: optionalText(formData, "websiteUrl"),
    sector: optionalText(formData, "sector"),
    primaryGeography: optionalText(formData, "primaryGeography"),
  });
  redirect(`/businesses/${business.id}`);
}

export async function archiveBusinessAction(formData: FormData) {
  const business = await getBusinessService().archive(text(formData, "businessId"));
  redirect(`/businesses/${business.id}`);
}

export async function restoreBusinessAction(formData: FormData) {
  const business = await getBusinessService().restore(text(formData, "businessId"));
  redirect(`/businesses/${business.id}`);
}

export async function permanentlyDeleteBusinessAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  try {
    await getBusinessService().permanentlyDelete({
      businessId,
      confirmation: text(formData, "confirmation"),
    });
  } catch (error) {
    const safeMessage = error instanceof Error && [
      "Business must be archived before it can be permanently deleted.",
      "Business confirmation does not match.",
      "Business not found.",
    ].includes(error.message)
      ? error.message
      : "Business could not be permanently deleted.";
    redirect(`/businesses/${businessId}/delete?error=${encodeURIComponent(safeMessage)}`);
  }
  redirect("/businesses/archived?deleted=1");
}

export async function runEvidenceExtractionAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const rawIntakeText = text(formData, "rawIntakeText");
  const sourceReference = optionalText(formData, "sourceReference");
  let target: string;
  try {
    const extraction = await getInitialIntakeService().submit({
      businessId,
      rawIntakeText,
      sourceReference,
    });
    target = `/businesses/${businessId}/reviews/${extraction.run.id}`;
  } catch (error) {
    target = error instanceof InitialIntakeUnavailableError
      ? initialIntakeUnavailableTarget(businessId, error.availability)
      : evidenceExtractionFailureTarget(businessId, error);
  }
  redirect(target);
}

export async function startEvidenceReviewAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const extractionRunId = text(formData, "extractionRunId");
  let target: string;
  try {
    const session = await getEvidenceReviewService().startReview({
      businessId,
      extractionRunId,
      reviewerId: text(formData, "reviewerId"),
    });
    target = `/businesses/${businessId}/reviews/${extractionRunId}?session=${session.id}`;
  } catch (error) {
    target = `/businesses/${businessId}/reviews/${extractionRunId}?error=${encodeURIComponent(errorMessage(error))}`;
  }
  redirect(target);
}

function correctedPayload(formData: FormData, proposalType: string) {
  if (proposalType === "claim") {
    return {
      statement: text(formData, "statement"),
      claimType: text(formData, "claimType"),
      subjectArea: text(formData, "subjectArea"),
      confidenceLevel: text(formData, "confidenceLevel"),
      confidenceScore: nullableNumber(formData, "confidenceScore"),
      confidenceBasis: { basis: text(formData, "confidenceBasis") },
    };
  }
  if (proposalType === "evidence") {
    return {
      statement: text(formData, "statement"),
      evidenceType: text(formData, "evidenceType"),
      valueNumeric: nullableNumber(formData, "valueNumeric"),
      valuePrecision: nullableText(formData, "valuePrecision"),
      valueLower: nullableNumber(formData, "valueLower"),
      valueUpper: nullableNumber(formData, "valueUpper"),
      valueText: nullableText(formData, "valueText"),
      unit: nullableText(formData, "unit"),
      periodStart: nullableText(formData, "periodStart"),
      periodEnd: nullableText(formData, "periodEnd"),
      reliabilityLevel: text(formData, "reliabilityLevel"),
      reliabilityScore: nullableNumber(formData, "reliabilityScore"),
      directnessLevel: text(formData, "directnessLevel"),
      recencyLevel: text(formData, "recencyLevel"),
      materiality: text(formData, "materiality"),
      sourceNotes: nullableText(formData, "sourceNotes"),
    };
  }
  if (proposalType === "metric") {
    return {
      metricKey: text(formData, "metricKey"),
      metricLabel: text(formData, "metricLabel"),
      numericValue: nullableNumber(formData, "numericValue"),
      numericPrecision: text(formData, "numericPrecision"),
      numericLower: nullableNumber(formData, "numericLower"),
      numericUpper: nullableNumber(formData, "numericUpper"),
      unit: text(formData, "unit"),
      periodStart: nullableText(formData, "periodStart"),
      periodEnd: nullableText(formData, "periodEnd"),
      dimensionData: {
        dimension: nullableText(formData, "dimension"),
        value: nullableText(formData, "dimensionValue"),
      },
    };
  }
  return {
    relationshipType: text(formData, "relationshipType"),
    strengthScore: nullableNumber(formData, "strengthScore"),
  };
}

export async function reviewProposalAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const extractionRunId = text(formData, "extractionRunId");
  const reviewSessionId = text(formData, "reviewSessionId");
  const decision = text(formData, "decision");
  let target: string;
  try {
    await getEvidenceReviewService().reviewProposal({
      businessId,
      reviewSessionId,
      proposalId: text(formData, "proposalId"),
      reviewerId: text(formData, "reviewerId"),
      decision,
      correctedPayload: decision === "CORRECTED"
        ? correctedPayload(formData, text(formData, "proposalType"))
        : undefined,
      reason: optionalText(formData, "reason"),
    });
    target = `/businesses/${businessId}/reviews/${extractionRunId}?session=${reviewSessionId}`;
  } catch (error) {
    target = `/businesses/${businessId}/reviews/${extractionRunId}?session=${reviewSessionId}&error=${encodeURIComponent(errorMessage(error))}`;
  }
  redirect(target);
}

export async function completeEvidenceReviewAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const runId = text(formData, "extractionRunId");
  const sessionId = text(formData, "reviewSessionId");
  let target: string;
  try {
    await getEvidenceReviewService().completeReview({
      businessId,
      reviewSessionId: sessionId,
      reviewerId: text(formData, "reviewerId"),
    });
    target = `/businesses/${businessId}/reviews/${runId}?session=${sessionId}`;
  } catch (error) {
    target = `/businesses/${businessId}/reviews/${runId}?session=${sessionId}&error=${encodeURIComponent(errorMessage(error))}`;
  }
  redirect(target);
}

export async function admitFactAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target: string;
  try {
    await getFactAdmissionService().promoteToFact({
      currentClaimId: text(formData, "claimId"),
      claim: {
        businessId,
        statement: text(formData, "statement"),
        subjectArea: text(formData, "subjectArea"),
        confidenceLevel: "high",
        confidenceBasis: { basis: text(formData, "basis") },
        sourceType: "human_fact_admission",
      },
      supportingEvidenceIds: [text(formData, "evidenceId")],
      authority: deriveHumanAuthority({
        actorType: "human",
        actorId: text(formData, "reviewerId"),
      }),
    });
    target = `/businesses/${businessId}/evidence`;
  } catch (error) {
    target = `/businesses/${businessId}/evidence?error=${encodeURIComponent(errorMessage(error))}`;
  }
  redirect(target);
}

export async function continueWithGapsAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = `/businesses/${businessId}/evidence-quality`;
  try {
    await getGapResolutionService().continueWithGaps({ businessId });
  } catch {
    target += "?error=continue";
  }
  redirect(target);
}

export async function analyseEvidenceAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = `/businesses/${businessId}/evidence-quality`;
  try {
    await getEvidenceCoherenceService().analyseCurrentSnapshot({ businessId });
  } catch {
    target += "?error=1";
  }
  redirect(target);
}

function diagnosisTarget(businessId: string, error?: unknown) {
  const base = `/businesses/${businessId}/diagnosis`;
  return error === undefined ? base : `${base}?error=${encodeURIComponent(errorMessage(error))}`;
}

/** Human-initiated Phase 1 Diagnosis of the latest snapshot. */
export async function generateDiagnosisAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = diagnosisTarget(businessId);
  try {
    await getPhase1DiagnosisService().generate({ businessId });
  } catch (error) {
    target = diagnosisTarget(businessId, error);
  }
  redirect(target);
}

export async function startDiagnosisReviewAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = diagnosisTarget(businessId);
  try {
    await getPhase1DiagnosisService().startReview({
      businessId,
      runId: text(formData, "runId"),
      reviewerId: text(formData, "reviewerId"),
    });
  } catch (error) {
    target = diagnosisTarget(businessId, error);
  }
  redirect(target);
}

export async function reviewDiagnosisItemAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const decision = text(formData, "decision");
  let target = diagnosisTarget(businessId);
  try {
    await getPhase1DiagnosisService().reviewItem({
      businessId,
      reviewSessionId: text(formData, "reviewSessionId"),
      reviewerId: text(formData, "reviewerId"),
      diagnosisItemId: text(formData, "diagnosisItemId"),
      decision,
      correctedPayload: decision === "CORRECTED" ? {
        itemType: text(formData, "itemType"),
        statement: text(formData, "statement"),
        rationale: text(formData, "rationale"),
        grounding: text(formData, "grounding"),
        materiality: text(formData, "materiality"),
        interpretationConfidence: nullableText(formData, "interpretationConfidence"),
        limitations: nullableText(formData, "limitations"),
        references: parseReferenceLines(text(formData, "references")),
      } : undefined,
      reason: optionalText(formData, "reason"),
    });
  } catch (error) {
    target = diagnosisTarget(businessId, error);
  }
  redirect(target);
}

export async function approveDiagnosisAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = diagnosisTarget(businessId);
  try {
    await getPhase1DiagnosisService().approve({
      businessId,
      reviewSessionId: text(formData, "reviewSessionId"),
      reviewerId: text(formData, "reviewerId"),
    });
  } catch (error) {
    target = diagnosisTarget(businessId, error);
  }
  redirect(target);
}

export async function requestDiagnosisRevisionAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  let target = diagnosisTarget(businessId);
  try {
    await getPhase1DiagnosisService().requestRevision({ businessId, reason: optionalText(formData, "reason") });
  } catch (error) {
    target = diagnosisTarget(businessId, error);
  }
  redirect(target);
}
