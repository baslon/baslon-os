import { z } from "zod";
import {
  analysisFindingReferenceRoles,
  evidenceQualityAreas,
  findingMaterialities,
} from "@/domain/evidence-coherence";
import type { EvidenceCoherenceProjection } from "@/domain/evidence-coherence";

const localRef = z.string().regex(/^[a-z][a-z0-9_]*$/);
const canonicalReference = z.object({
  recordType: z.enum(["claim", "evidence", "metric"]),
  recordId: z.uuid(),
  role: z.enum(analysisFindingReferenceRoles),
}).strict();

export const contradictionOutputSchema = z.object({
  findingRef: localRef,
  area: z.enum(evidenceQualityAreas),
  statement: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  materiality: z.enum(findingMaterialities),
  priorityRank: z.number().int().positive(),
  references: z.array(canonicalReference).min(2),
}).strict();

export const evidenceGapOutputSchema = z.object({
  findingRef: localRef,
  area: z.enum(evidenceQualityAreas),
  missingInformation: z.string().trim().min(1),
  decisionImpact: z.string().trim().min(1),
  materiality: z.enum(findingMaterialities),
  priorityRank: z.number().int().positive(),
  references: z.array(canonicalReference),
}).strict();

export const analysisQuestionOutputSchema = z.object({
  findingType: z.enum(["contradiction", "gap"]),
  findingRef: localRef,
  question: z.string().trim().min(1),
  priorityOrder: z.number().int().positive(),
}).strict();

export const evidenceCoherenceOutputSchema = z.object({
  contradictions: z.array(contradictionOutputSchema),
  gaps: z.array(evidenceGapOutputSchema),
  questions: z.array(analysisQuestionOutputSchema),
}).strict();

export type EvidenceCoherenceOutput = z.output<typeof evidenceCoherenceOutputSchema>;
export type EvidenceCoherenceModelInput = {
  projectionVersion: string;
  snapshot: EvidenceCoherenceProjection;
};

export const evidenceCoherenceJsonSchema = z.toJSONSchema(evidenceCoherenceOutputSchema);
