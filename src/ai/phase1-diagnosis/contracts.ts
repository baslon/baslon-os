import { z } from "zod";
import {
  diagnosisEntityTypes,
  diagnosisGroundings,
  diagnosisInterpretationConfidences,
  diagnosisItemTypes,
  diagnosisMaterialities,
  diagnosisReferenceRoles,
} from "@/domain/phase1-diagnosis";
import { PHASE1_DIAGNOSIS_HANDLE_PATTERN } from "@/domain/phase1-diagnosis-handles";

export type { Phase1DiagnosisModelInput } from "@/domain/phase1-diagnosis-projection";

/** A model-authored reference: a run-local handle, never a canonical UUID. */
export const diagnosisReferenceSchema = z.object({
  entityType: z.enum(diagnosisEntityTypes),
  ref: z.string().regex(new RegExp(PHASE1_DIAGNOSIS_HANDLE_PATTERN)),
  role: z.enum(diagnosisReferenceRoles),
}).strict();

/**
 * One diagnosis item. Every field is material and is shown on the review
 * surface. There is no priority rank; items keep the order the model returned.
 */
export const diagnosisItemSchema = z.object({
  itemType: z.enum(diagnosisItemTypes),
  statement: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  grounding: z.enum(diagnosisGroundings),
  materiality: z.enum(diagnosisMaterialities),
  interpretationConfidence: z.enum(diagnosisInterpretationConfidences).nullable(),
  limitations: z.string().trim().min(1).nullable(),
  references: z.array(diagnosisReferenceSchema),
}).strict();

/** `phase1_diagnosis_v1` output contract. */
export const phase1DiagnosisOutputSchema = z.object({
  items: z.array(diagnosisItemSchema).min(1),
}).strict();

export type Phase1DiagnosisOutput = z.output<typeof phase1DiagnosisOutputSchema>;
export type DiagnosisItemOutput = z.output<typeof diagnosisItemSchema>;

export const phase1DiagnosisJsonSchema = z.toJSONSchema(phase1DiagnosisOutputSchema);

/**
 * `phase1_diagnosis_v2` item: the v1 item plus a required `headline`, a short
 * presentation label for the statement. No v1 field changes meaning. Headline
 * structure and the number-subset rule are enforced by deterministic
 * validation, so the JSON schema stays within the v1 keyword set.
 */
export const diagnosisItemSchemaV2 = z.object({
  headline: z.string().trim().min(1),
  ...diagnosisItemSchema.shape,
}).strict();

/** `phase1_diagnosis_v2` output contract. */
export const phase1DiagnosisOutputSchemaV2 = z.object({
  items: z.array(diagnosisItemSchemaV2).min(1),
}).strict();

export type Phase1DiagnosisOutputV2 = z.output<typeof phase1DiagnosisOutputSchemaV2>;

export const phase1DiagnosisJsonSchemaV2 = z.toJSONSchema(phase1DiagnosisOutputSchemaV2);
