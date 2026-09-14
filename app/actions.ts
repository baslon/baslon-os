"use server";

import { redirect } from "next/navigation";
import {
  getBusinessService,
  getEvidenceExtractionService,
  getEvidenceReviewService,
  getFactAdmissionService,
  getStrategyOrchestrator,
} from "@/foundation";
import { deriveHumanAuthority } from "@/domain/server-authority";
import { evidenceExtractionFailureTarget } from "@/domain/intake-retry";

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

export async function runEvidenceExtractionAction(formData: FormData) {
  const businessId = text(formData, "businessId");
  const rawIntakeText = text(formData, "rawIntakeText");
  const sourceReference = optionalText(formData, "sourceReference");
  let target: string;
  try {
    const reviewService = getEvidenceReviewService();
    const orchestrator = getStrategyOrchestrator();
    let state = await reviewService.getWorkflowState(businessId);
    if (state === "NEW") {
      await orchestrator.transition({
        businessId, event: "START_INTAKE", actorType: "human", actorId: "business-user",
      });
      state = "INTAKE_IN_PROGRESS";
    }
    if (state === "INTAKE_IN_PROGRESS") {
      await orchestrator.transition({
        businessId, event: "SUBMIT_INTAKE", actorType: "human", actorId: "business-user",
      });
      state = "INTAKE_READY";
    }
    if (state === "INTAKE_READY") {
      await orchestrator.transition({
        businessId, event: "PROCESS_EVIDENCE", actorType: "system",
        actorId: "evidence-extraction-service",
      });
      state = "EVIDENCE_PROCESSING";
    }
    if (state !== "EVIDENCE_PROCESSING") {
      throw new Error(`Cannot run intake extraction while workflow is ${state}`);
    }
    const extraction = await getEvidenceExtractionService().extract({
      businessId,
      rawIntakeText,
      sourceType: "business_intake",
      sourceReference,
      sourceMetadata: { suppliedBy: "human_ui" },
    });
    target = `/businesses/${businessId}/reviews/${extraction.run.id}`;
  } catch (error) {
    target = evidenceExtractionFailureTarget(businessId, error);
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
      valueNumeric: nullableNumber(formData, "valueNumeric"),
      valueText: nullableText(formData, "valueText"),
      unit: nullableText(formData, "unit"),
      periodStart: nullableText(formData, "periodStart"),
      periodEnd: nullableText(formData, "periodEnd"),
      reliabilityLevel: text(formData, "reliabilityLevel"),
      reliabilityScore: nullableNumber(formData, "reliabilityScore"),
      directnessLevel: text(formData, "directnessLevel"),
      recencyLevel: text(formData, "recencyLevel"),
      materiality: text(formData, "materiality"),
    };
  }
  if (proposalType === "metric") {
    return {
      metricKey: text(formData, "metricKey"),
      metricLabel: text(formData, "metricLabel"),
      numericValue: Number(text(formData, "numericValue")),
      unit: text(formData, "unit"),
      periodStart: nullableText(formData, "periodStart"),
      periodEnd: nullableText(formData, "periodEnd"),
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
