import { z } from "zod";
import { numericPrecisions } from "@/domain/numeric-precision";

export const reviewDecisions = [
  "ACCEPTED", "CORRECTED", "REJECTED", "UNRESOLVED",
] as const;

export const startEvidenceReviewSchema = z.object({
  businessId: z.uuid(),
  extractionRunId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();

export const reviewProposalSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  proposalId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
  decision: z.enum(reviewDecisions),
  correctedPayload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "CORRECTED" && !value.correctedPayload) {
    context.addIssue({ code: "custom", path: ["correctedPayload"], message: "CORRECTED requires correctedPayload" });
  }
  if (value.decision !== "CORRECTED" && value.correctedPayload) {
    context.addIssue({ code: "custom", path: ["correctedPayload"], message: "Only CORRECTED may include correctedPayload" });
  }
});

export const completeEvidenceReviewSchema = z.object({
  businessId: z.uuid(),
  reviewSessionId: z.uuid(),
  reviewerId: z.string().trim().min(1).max(200),
}).strict();

export const claimCorrectionSchema = z.object({
  statement: z.string().trim().min(1).optional(),
  claimType: z.enum([
    "observation", "management_belief", "hypothesis", "ai_inference", "unknown",
  ]).optional(),
  subjectArea: z.string().trim().min(1).optional(),
  confidenceLevel: z.string().trim().min(1).optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
  confidenceBasis: z.object({ basis: z.string() }).strict().optional(),
}).strict();

export const evidenceCorrectionSchema = z.object({
  statement: z.string().trim().min(1).optional(),
  valueNumeric: z.number().finite().nullable().optional(),
  valuePrecision: z.enum(numericPrecisions).nullable().optional(),
  valueLower: z.number().finite().nullable().optional(),
  valueUpper: z.number().finite().nullable().optional(),
  valueText: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  periodStart: z.iso.date().nullable().optional(),
  periodEnd: z.iso.date().nullable().optional(),
  reliabilityLevel: z.string().trim().min(1).optional(),
  reliabilityScore: z.number().min(0).max(1).nullable().optional(),
  directnessLevel: z.string().trim().min(1).optional(),
  recencyLevel: z.string().trim().min(1).optional(),
  materiality: z.string().trim().min(1).optional(),
}).strict();

export const metricCorrectionSchema = z.object({
  metricKey: z.string().trim().min(1).optional(),
  metricLabel: z.string().trim().min(1).optional(),
  numericValue: z.number().finite().nullable().optional(),
  numericPrecision: z.enum(numericPrecisions).optional(),
  numericLower: z.number().finite().nullable().optional(),
  numericUpper: z.number().finite().nullable().optional(),
  unit: z.string().trim().min(1).optional(),
  periodStart: z.iso.date().nullable().optional(),
  periodEnd: z.iso.date().nullable().optional(),
  dimensionData: z.object({
    dimension: z.string().nullable(),
    value: z.string().nullable(),
  }).strict().optional(),
  sourceEvidenceRef: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable().optional(),
}).strict();

export const relationshipCorrectionSchema = z.object({
  relationshipType: z.enum(["supports", "contradicts", "context"]).optional(),
  strengthScore: z.number().min(0).max(1).nullable().optional(),
}).strict();

export type ReviewDecision = (typeof reviewDecisions)[number];
