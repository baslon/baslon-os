import type { z } from "zod";
import {
  diagnosisItemSchema,
  diagnosisItemSchemaV2,
  phase1DiagnosisOutputSchema,
  phase1DiagnosisOutputSchemaV2,
} from "@/ai/phase1-diagnosis/contracts";
import { PHASE1_DIAGNOSIS_PROMPT_V1, PHASE1_DIAGNOSIS_PROMPT_V2 } from "@/ai/phase1-diagnosis/prompt";
import {
  PHASE1_DIAGNOSIS_ARTIFACT_V1,
  PHASE1_DIAGNOSIS_ARTIFACT_V2,
  type DiagnosisItemDraft,
} from "@/domain/phase1-diagnosis";
import {
  diagnosisReviewFields,
  diagnosisReviewFieldsV2,
  type DiagnosisReviewField,
} from "@/domain/phase1-diagnosis-review-card";

/**
 * Version dispatch for Phase 1 Diagnosis. Every read, validation, effective
 * item and artifact build selects its contract from persisted provenance (the
 * run's `prompt_version`, the artifact's `artifactVersion`), never from the
 * version new runs use. v1 stays exactly as it was: its strict item schema
 * has no headline, so stored v1 corrections keep parsing unchanged.
 */
export type Phase1DiagnosisContract = {
  promptVersion: string;
  artifactVersion: string;
  hasHeadline: boolean;
  itemSchema: z.ZodType<DiagnosisItemDraft>;
  outputSchema: z.ZodType<{ items: DiagnosisItemDraft[] }>;
  reviewFields: readonly DiagnosisReviewField[];
};

const contracts: readonly Phase1DiagnosisContract[] = [
  {
    promptVersion: PHASE1_DIAGNOSIS_PROMPT_V1,
    artifactVersion: PHASE1_DIAGNOSIS_ARTIFACT_V1,
    hasHeadline: false,
    itemSchema: diagnosisItemSchema,
    outputSchema: phase1DiagnosisOutputSchema,
    reviewFields: diagnosisReviewFields,
  },
  {
    promptVersion: PHASE1_DIAGNOSIS_PROMPT_V2,
    artifactVersion: PHASE1_DIAGNOSIS_ARTIFACT_V2,
    hasHeadline: true,
    itemSchema: diagnosisItemSchemaV2,
    outputSchema: phase1DiagnosisOutputSchemaV2,
    reviewFields: diagnosisReviewFieldsV2,
  },
];

export class UnsupportedDiagnosisVersionError extends Error {
  constructor(kind: "prompt" | "artifact", version: string) {
    super(`Unsupported Phase 1 Diagnosis ${kind} version: ${version}`);
    this.name = "UnsupportedDiagnosisVersionError";
  }
}

/** Fails closed on any version this code does not implement. */
export function diagnosisContractForPrompt(promptVersion: string): Phase1DiagnosisContract {
  const contract = contracts.find((entry) => entry.promptVersion === promptVersion);
  if (!contract) throw new UnsupportedDiagnosisVersionError("prompt", promptVersion);
  return contract;
}

export function diagnosisContractForArtifact(artifactVersion: string): Phase1DiagnosisContract {
  const contract = contracts.find((entry) => entry.artifactVersion === artifactVersion);
  if (!contract) throw new UnsupportedDiagnosisVersionError("artifact", artifactVersion);
  return contract;
}
