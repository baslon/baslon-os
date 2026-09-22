import {
  diagnosisReferenceRoles,
  type DiagnosisItemDraft,
  type DiagnosisReferenceRole,
} from "@/domain/phase1-diagnosis";
import { diagnosisHandleNamespace } from "@/domain/phase1-diagnosis-handles";

/**
 * Every material field a diagnosis item persists, and the label it is shown
 * under before any decision (M4-07; the M4-11 lesson). A regression test keeps
 * this manifest equal to the output schema and to the persisted columns.
 */
export const diagnosisReviewFields = [
  { field: "itemType", label: "Type" },
  { field: "statement", label: "Conclusion" },
  { field: "rationale", label: "Rationale" },
  { field: "grounding", label: "Grounding" },
  { field: "materiality", label: "Materiality" },
  { field: "interpretationConfidence", label: "Interpretation confidence" },
  { field: "limitations", label: "Limitations" },
  { field: "references", label: "Supporting references" },
] as const satisfies ReadonlyArray<{ field: keyof DiagnosisItemDraft; label: string }>;

/** `phase1_diagnosis_v2` items add the headline as a first-class material field. */
export const diagnosisReviewFieldsV2 = [
  { field: "headline", label: "Headline" },
  ...diagnosisReviewFields,
] as const satisfies ReadonlyArray<{ field: keyof DiagnosisItemDraft; label: string }>;

export type DiagnosisReviewField = (typeof diagnosisReviewFieldsV2)[number];

export const DIAGNOSIS_REVIEW_CARD_VERSION = "phase1_diagnosis_review_v1";

/**
 * Parses a reviewer's reference list: one `role handle` per line, for example
 * `primary E001` or `limiting_gap G002`. The entity type comes from the handle
 * namespace. Anything unparseable is kept as written, so deterministic
 * validation rejects it visibly rather than it being silently dropped.
 */
export function parseReferenceLines(text: string): DiagnosisItemDraft["references"] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    const [role = "", ref = ""] = parts;
    const entityType = diagnosisHandleNamespace(ref) ?? "evidence";
    const knownRole = (diagnosisReferenceRoles as readonly string[]).includes(role);
    const wellFormed = parts.length === 2 && knownRole && diagnosisHandleNamespace(ref) !== null;
    return {
      entityType,
      ref: wellFormed ? ref : line,
      role: knownRole ? role as DiagnosisReferenceRole : "primary",
    };
  });
}

export function formatReferenceLines(references: Array<{ role: string; handle: string }>): string {
  return references.map((reference) => `${reference.role} ${reference.handle}`).join("\n");
}
