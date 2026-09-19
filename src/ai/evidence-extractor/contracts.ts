import { z } from "zod";
import {
  numericPrecisions,
  numericShapeIssue,
  proposableNumericPrecisions,
  type NumericPrecision,
} from "@/domain/numeric-precision";

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

export const evidenceExtractionInterpretiveContextSchema = z.object({
  kind: z.literal("analysis_question"),
  questionId: z.uuid(),
  questionText: z.string().trim().min(1),
}).strict();

export const evidenceExtractionInputSchema = z.object({
  businessId: z.uuid(),
  sourceSubmissionId: z.uuid().optional(),
  rawIntakeText: z.string().trim().min(1),
  sourceType: z.string().trim().min(1).optional(),
  sourceReference: z.string().trim().min(1).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
  interpretiveContext: evidenceExtractionInterpretiveContextSchema.optional(),
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

const periodOrder = <T extends { periodStart: string | null; periodEnd: string | null }>(value: T) =>
  !value.periodStart || !value.periodEnd || value.periodEnd >= value.periodStart;
const periodOrderIssue = { message: "periodEnd must be on or after periodStart", path: ["periodEnd"] };
const nullableFiniteNumber = z.number().finite().nullable();

const evidenceFields = {
  proposalRef,
  evidenceType: z.string().trim().min(1),
  statement: z.string().trim().min(1),
  valueNumeric: nullableFiniteNumber,
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
};

function evidenceShapeCheck(value: {
  valuePrecision: NumericPrecision | null;
  valueNumeric: number | null;
  valueLower: number | null;
  valueUpper: number | null;
}, context: z.RefinementCtx) {
  const issue = numericShapeIssue({
    precision: value.valuePrecision,
    value: value.valueNumeric,
    lower: value.valueLower,
    upper: value.valueUpper,
  });
  if (issue) context.addIssue({ code: "custom", path: ["valuePrecision"], message: issue });
}

/** Evidence proposal shape emitted before numeric precision existed (evidence_extractor_v4/v5). */
export const legacyEvidenceProposalSchema = z.object(evidenceFields).strict()
  .refine(periodOrder, periodOrderIssue);

/**
 * Evidence proposal emitted from evidence_extractor_v6/v7. A numeric value or
 * range always carries an explicit precision; qualitative Evidence has none.
 */
export const evidenceProposalSchema = z.object({
  ...evidenceFields,
  valuePrecision: z.enum(proposableNumericPrecisions).nullable(),
  valueLower: nullableFiniteNumber,
  valueUpper: nullableFiniteNumber,
}).strict()
  .refine(periodOrder, periodOrderIssue)
  .superRefine(evidenceShapeCheck);

/** Evidence as reviewed by a human, who may also record `unspecified`. */
export const reviewableEvidenceProposalSchema = z.object({
  ...evidenceFields,
  valuePrecision: z.enum(numericPrecisions).nullable(),
  valueLower: nullableFiniteNumber,
  valueUpper: nullableFiniteNumber,
}).strict()
  .refine(periodOrder, periodOrderIssue)
  .superRefine(evidenceShapeCheck);

const metricFields = {
  proposalRef,
  metricKey: z.string().trim().min(1),
  metricLabel: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  periodStart: nullableDate,
  periodEnd: nullableDate,
  dimensionData: dimensionDataSchema,
  sourceEvidenceRef: proposalRef.nullable(),
  sourceExcerpt: z.string().trim().min(1),
};

function metricShapeCheck(value: {
  numericPrecision: NumericPrecision;
  numericValue: number | null;
  numericLower: number | null;
  numericUpper: number | null;
}, context: z.RefinementCtx) {
  const issue = numericShapeIssue({
    precision: value.numericPrecision,
    value: value.numericValue,
    lower: value.numericLower,
    upper: value.numericUpper,
  });
  if (issue) context.addIssue({ code: "custom", path: ["numericPrecision"], message: issue });
  if (value.numericPrecision !== "range" && value.numericValue === null) {
    context.addIssue({ code: "custom", path: ["numericValue"], message: "a Metric requires a numeric value or a range" });
  }
}

/** Metric proposal shape emitted before numeric precision existed (evidence_extractor_v4/v5). */
export const legacyMetricProposalSchema = z.object({
  ...metricFields,
  numericValue: z.number().finite(),
}).strict().refine(periodOrder, periodOrderIssue);

/** Metric proposal emitted from evidence_extractor_v6/v7: a single value or a range, with explicit precision. */
export const metricProposalSchema = z.object({
  ...metricFields,
  numericValue: nullableFiniteNumber,
  numericPrecision: z.enum(proposableNumericPrecisions),
  numericLower: nullableFiniteNumber,
  numericUpper: nullableFiniteNumber,
}).strict()
  .refine(periodOrder, periodOrderIssue)
  .superRefine(metricShapeCheck);

/** Metric as reviewed by a human, who may also record `unspecified`. */
export const reviewableMetricProposalSchema = z.object({
  ...metricFields,
  numericValue: nullableFiniteNumber,
  numericPrecision: z.enum(numericPrecisions),
  numericLower: nullableFiniteNumber,
  numericUpper: nullableFiniteNumber,
}).strict()
  .refine(periodOrder, periodOrderIssue)
  .superRefine(metricShapeCheck);

export type ReviewableEvidenceProposal = z.output<typeof reviewableEvidenceProposalSchema>;
export type ReviewableMetricProposal = z.output<typeof reviewableMetricProposalSchema>;

/**
 * Reads a stored (immutable) Evidence proposal into the reviewable shape.
 * Pre-precision proposals keep their value and read as `unspecified`; nothing
 * is inferred from their wording.
 */
export function readStoredEvidenceProposal(payload: unknown): ReviewableEvidenceProposal {
  if (payload && typeof payload === "object" && "valuePrecision" in payload) {
    return reviewableEvidenceProposalSchema.parse(payload);
  }
  const legacy = legacyEvidenceProposalSchema.parse(payload);
  return {
    ...legacy,
    valuePrecision: legacy.valueNumeric === null ? null : "unspecified",
    valueLower: null,
    valueUpper: null,
  };
}

/** Reads a stored (immutable) Metric proposal; pre-precision proposals read as `unspecified`. */
export function readStoredMetricProposal(payload: unknown): ReviewableMetricProposal {
  if (payload && typeof payload === "object" && "numericPrecision" in payload) {
    return reviewableMetricProposalSchema.parse(payload);
  }
  const legacy = legacyMetricProposalSchema.parse(payload);
  return { ...legacy, numericPrecision: "unspecified", numericLower: null, numericUpper: null };
}

export const claimEvidenceProposalSchema = z.object({
  proposalRef,
  claimRef: proposalRef,
  evidenceRef: proposalRef,
  relationshipType: z.enum(["supports", "contradicts", "context"]),
  // Confidence that the selected semantic relationship type is appropriate;
  // never Evidence credibility, Claim truth, proof weight or materiality.
  strengthScore: nullableScore,
}).strict();

export const evidenceExtractionOutputSchema = z.object({
  claims: z.array(claimProposalSchema),
  evidence: z.array(evidenceProposalSchema),
  metrics: z.array(metricProposalSchema),
  relationships: z.array(claimEvidenceProposalSchema),
}).strict();

export type EvidenceExtractionInput = z.output<typeof evidenceExtractionInputSchema>;
export type EvidenceExtractionModelInput = Omit<EvidenceExtractionInput, "businessId" | "sourceSubmissionId">;
export type EvidenceExtractionOutput = z.output<typeof evidenceExtractionOutputSchema>;

export const evidenceExtractionJsonSchema = z.toJSONSchema(
  evidenceExtractionOutputSchema,
);
