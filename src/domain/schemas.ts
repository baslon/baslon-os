import { z } from "zod";

const score = z.number().min(0).max(1);
const dateString = z.iso.date();
const optionalUrl = z.union([z.url(), z.literal("")]).optional()
  .transform((value) => value || undefined);

export const claimTypes = [
  "fact", "observation", "management_belief", "hypothesis",
  "ai_inference", "unknown", "decision",
] as const;

export const businessInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(200).optional(),
  websiteUrl: optionalUrl,
  sector: z.string().trim().max(120).optional(),
  primaryGeography: z.string().trim().max(120).optional(),
  profileData: z.record(z.string(), z.unknown()).default({}),
});

export const businessProfileInputSchema = z.object({
  businessId: z.uuid(),
  profileData: z.record(z.string(), z.unknown()),
});

export const claimInputSchema = z.object({
  businessId: z.uuid(),
  statement: z.string().trim().min(1),
  claimType: z.enum(claimTypes),
  subjectArea: z.string().trim().min(1),
  status: z.string().trim().min(1).default("active"),
  confidenceLevel: z.string().trim().min(1),
  confidenceScore: score.optional(),
  confidenceBasis: z.record(z.string(), z.unknown()).default({}),
  sourceType: z.string().trim().min(1),
});

export const evidenceInputSchema = z.object({
  businessId: z.uuid(),
  evidenceType: z.string().trim().min(1),
  statement: z.string().trim().min(1),
  valueNumeric: z.number().optional(),
  valueText: z.string().optional(),
  unit: z.string().optional(),
  periodStart: dateString.optional(),
  periodEnd: dateString.optional(),
  sourceType: z.string().trim().min(1),
  sourceReference: z.string().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
  reliabilityLevel: z.string().trim().min(1),
  reliabilityScore: score.optional(),
  directnessLevel: z.string().trim().min(1),
  recencyLevel: z.string().trim().min(1),
  rawPayload: z.record(z.string(), z.unknown()).default({}),
  materiality: z.string().trim().min(1),
}).refine(
  (value) => !value.periodStart || !value.periodEnd || value.periodEnd >= value.periodStart,
  { message: "periodEnd must be on or after periodStart", path: ["periodEnd"] },
);

export const metricInputSchema = z.object({
  businessId: z.uuid(),
  metricKey: z.string().trim().min(1),
  metricLabel: z.string().trim().min(1),
  numericValue: z.number(),
  unit: z.string().trim().min(1),
  periodStart: dateString.optional(),
  periodEnd: dateString.optional(),
  dimensionData: z.record(z.string(), z.unknown()).default({}),
  sourceEvidenceId: z.uuid().optional(),
});

export const claimEvidenceInputSchema = z.object({
  claimId: z.uuid(),
  evidenceId: z.uuid(),
  relationshipType: z.enum(["supports", "contradicts", "context"]),
  strengthScore: score.optional(),
});

export type BusinessInput = z.input<typeof businessInputSchema>;
export type ClaimInput = z.input<typeof claimInputSchema>;
export type EvidenceInput = z.input<typeof evidenceInputSchema>;
export type MetricInput = z.input<typeof metricInputSchema>;
