import { z } from "zod";
import {
  analysisFindingReferenceRoles,
  evidenceCoherenceEntityTypes,
  evidenceQualityAreas,
  findingMaterialities,
} from "@/domain/evidence-coherence";
import { EVIDENCE_COHERENCE_HANDLE_PATTERN } from "@/domain/evidence-coherence-handles";

export type { EvidenceCoherenceModelInput, EvidenceCoherenceV2ModelInput } from "@/domain/evidence-coherence";

const localRef = z.string().regex(/^[a-z][a-z0-9_]*$/);

function outputSchema<Reference extends z.ZodType>(reference: Reference) {
  return z.object({
    contradictions: z.array(z.object({
      findingRef: localRef,
      area: z.enum(evidenceQualityAreas),
      statement: z.string().trim().min(1),
      rationale: z.string().trim().min(1),
      materiality: z.enum(findingMaterialities),
      priorityRank: z.number().int().positive(),
      references: z.array(reference).min(2),
    }).strict()),
    gaps: z.array(z.object({
      findingRef: localRef,
      area: z.enum(evidenceQualityAreas),
      missingInformation: z.string().trim().min(1),
      decisionImpact: z.string().trim().min(1),
      materiality: z.enum(findingMaterialities),
      priorityRank: z.number().int().positive(),
      references: z.array(reference),
    }).strict()),
    questions: z.array(z.object({
      findingType: z.enum(["contradiction", "gap"]),
      findingRef: localRef,
      question: z.string().trim().min(1),
      priorityOrder: z.number().int().positive(),
    }).strict()),
  }).strict();
}

/**
 * Canonical finding reference. Under `evidence_coherence_v4` it is produced only
 * by application code from a validated snapshot-local handle, then persisted.
 */
const canonicalReference = z.object({
  recordType: z.enum(evidenceCoherenceEntityTypes),
  recordId: z.uuid(),
  role: z.enum(analysisFindingReferenceRoles),
}).strict();

/** Model-authored finding reference under `evidence_coherence_v4` (M4-12). */
const handleReference = z.object({
  entityType: z.enum(evidenceCoherenceEntityTypes),
  ref: z.string().regex(new RegExp(EVIDENCE_COHERENCE_HANDLE_PATTERN)),
  role: z.enum(analysisFindingReferenceRoles),
}).strict();

/**
 * Frozen `evidence_coherence_v3` output contract, in which the model reproduced
 * canonical UUIDs. Kept so historical raw output remains interpretable; no
 * current path asks a model for it.
 */
export const evidenceCoherenceV3OutputSchema = outputSchema(canonicalReference);

/** Current `evidence_coherence_v4` output contract: references are snapshot-local handles. */
export const evidenceCoherenceOutputSchema = outputSchema(handleReference);

/** Model output after schema validation, still expressed in handles. */
export type EvidenceCoherenceModelOutput = z.output<typeof evidenceCoherenceOutputSchema>;

/** Validated output with every handle resolved to a canonical UUID; the only shape persisted. */
export type EvidenceCoherenceOutput = z.output<typeof evidenceCoherenceV3OutputSchema>;

export const evidenceCoherenceJsonSchema = z.toJSONSchema(evidenceCoherenceOutputSchema);
