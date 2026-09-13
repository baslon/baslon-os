import { z } from "zod";

const nullableScore = z.number().min(0).max(1).nullable();
const nullableDate = z.iso.date().nullable();
const proposalRef = z.string().regex(/^[a-z][a-z0-9_]*$/);

const confidenceBasisSchema = z.object({
  basis: z.string(),
}).strict();

const sourceMetadataSchema = z.object({
  suppliedBy: z.string().nullable(),
  notes: z.string().nullable(),
}).strict();

const rawPayloadSchema = z.object({
  excerpt: z.string(),
}).strict();

const dimensionDataSchema = z.object({
  dimension: z.string().nullable(),
  value: z.string().nullable(),
}).strict();

export const evidenceExtractionInputSchema = z.object({
  businessId: z.uuid(),
  rawIntakeText: z.string().trim().min(1),
  sourceType: z.string().trim().min(1).optional(),
  sourceReference: z.string().trim().min(1).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const claimProposalSchema = z.object({
  proposalRef,
  statement: z.string().trim().min(1),
  claimType: z.enum([
    "observation", "management_belief", "hypothesis", "ai_inference", "unknown",
  ]),
  subjectArea: z.string().trim().min(1),
  confidenceLevel: z.string().trim().min(1),
  confidenceScore: nullableScore,
  confidenceBasis: confidenceBasisSchema,
  sourceType: z.string().trim().min(1),
}).strict();

export const evidenceProposalSchema = z.object({
  proposalRef,
  evidenceType: z.string().trim().min(1),
  statement: z.string().trim().min(1),
  valueNumeric: z.number().finite().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  periodStart: nullableDate,
  periodEnd: nullableDate,
  sourceType: z.string().trim().min(1),
  sourceReference: z.string().nullable(),
  sourceMetadata: sourceMetadataSchema,
  reliabilityLevel: z.string().trim().min(1),
  reliabilityScore: nullableScore,
  directnessLevel: z.string().trim().min(1),
  recencyLevel: z.string().trim().min(1),
  rawPayload: rawPayloadSchema,
  materiality: z.string().trim().min(1),
  sourceExcerpt: z.string().trim().min(1),
}).strict().refine(
  (value) => !value.periodStart || !value.periodEnd || value.periodEnd >= value.periodStart,
  { message: "periodEnd must be on or after periodStart", path: ["periodEnd"] },
);

export const metricProposalSchema = z.object({
  proposalRef,
  metricKey: z.string().trim().min(1),
  metricLabel: z.string().trim().min(1),
  numericValue: z.number().finite(),
  unit: z.string().trim().min(1),
  periodStart: nullableDate,
  periodEnd: nullableDate,
  dimensionData: dimensionDataSchema,
  sourceEvidenceRef: proposalRef.nullable(),
  sourceExcerpt: z.string().trim().min(1),
}).strict().refine(
  (value) => !value.periodStart || !value.periodEnd || value.periodEnd >= value.periodStart,
  { message: "periodEnd must be on or after periodStart", path: ["periodEnd"] },
);

export const claimEvidenceProposalSchema = z.object({
  proposalRef,
  claimRef: proposalRef,
  evidenceRef: proposalRef,
  relationshipType: z.enum(["supports", "contradicts", "context"]),
  strengthScore: nullableScore,
}).strict();

export const evidenceExtractionOutputSchema = z.object({
  claims: z.array(claimProposalSchema),
  evidence: z.array(evidenceProposalSchema),
  metrics: z.array(metricProposalSchema),
  relationships: z.array(claimEvidenceProposalSchema),
}).strict();

export type EvidenceExtractionInput = z.output<typeof evidenceExtractionInputSchema>;
export type EvidenceExtractionModelInput = Omit<EvidenceExtractionInput, "businessId">;
export type EvidenceExtractionOutput = z.output<typeof evidenceExtractionOutputSchema>;

export const evidenceExtractionJsonSchema = z.toJSONSchema(
  evidenceExtractionOutputSchema,
);
