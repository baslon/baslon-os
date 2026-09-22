import type { NumericPrecision } from "@/domain/numeric-precision";

/**
 * Phase 1 Diagnosis contract (M4-05 / M4-06 / M4-07).
 *
 * AI analyses one immutable evidence snapshot. Software enforces the contract.
 * Humans approve material strategic interpretation. Diagnosis output is
 * analytical state and never canonical Claims, Evidence, Metrics or
 * relationships.
 */
export const PHASE1_DIAGNOSIS_MODULE = "phase1_diagnosis";
export const PHASE1_DIAGNOSIS_RUN_TYPE = "snapshot_diagnosis";
/** The input projection is unchanged by v2, so both prompt versions use it. */
export const PHASE1_DIAGNOSIS_INPUT_VERSION = "phase1_diagnosis_input_v1";
/** Schema versions of the frozen `approved_diagnoses.approved_content` artifact. */
export const PHASE1_DIAGNOSIS_ARTIFACT_V1 = "phase1_diagnosis_artifact_v1";
export const PHASE1_DIAGNOSIS_ARTIFACT_V2 = "phase1_diagnosis_artifact_v2";

/**
 * v1 revision semantics: a diagnosis sent for revision is never re-run or
 * reused on the snapshot that produced it. A new diagnosis needs a newer
 * snapshot, reached through the normal evidence and coherence path back to
 * PHASE1_READY. Same-snapshot re-diagnosis would need its own run-identity and
 * revision contract.
 */
export const REVISION_REQUIRES_NEW_SNAPSHOT_MESSAGE =
  "A new diagnosis requires updated evidence and a new snapshot. Add or review information first, then run Phase 1 Diagnosis again. If the evidence is correct but an interpretation needs changing, use Correct during diagnosis review.";

/** Diagnostic category of one analytical item. */
export const diagnosisItemTypes = [
  "position",
  "strength",
  "constraint",
  "risk",
  "opportunity",
  "limitation",
  "decision_required",
] as const;

/**
 * How an item is supported. `evidence_backed` and `calculated` must cite
 * primary support; `interpretive` and `hypothesis` are AI interpretation and
 * must state their limitation.
 */
export const diagnosisGroundings = ["evidence_backed", "calculated", "interpretive", "hypothesis"] as const;

/**
 * Diagnosis-local labels, defined only for Phase 1 Diagnosis (B-09 stays open).
 * Materiality: could the issue materially affect the business or its strategy.
 * It is not truth. Interpretation confidence: confidence in the analytical
 * interpretation. It is not a truth probability and is never computed from
 * Evidence qualifiers.
 */
export const diagnosisMaterialities = ["low", "medium", "high"] as const;
export const diagnosisInterpretationConfidences = ["low", "medium", "high"] as const;

/** Why a record is cited. `limiting_gap` is reserved for validated gaps. */
export const diagnosisReferenceRoles = ["primary", "context", "limiting_gap"] as const;

/** Snapshot/run-local reference namespaces. Application code owns identity. */
export const diagnosisEntityTypes = ["claim", "evidence", "metric", "gap", "calculation"] as const;

export const diagnosisReviewDecisions = ["ACCEPTED", "CORRECTED", "REJECTED"] as const;
export const diagnosisReviewSessionStatuses = ["OPEN", "COMPLETED"] as const;

export type DiagnosisItemType = (typeof diagnosisItemTypes)[number];
export type DiagnosisGrounding = (typeof diagnosisGroundings)[number];
export type DiagnosisMateriality = (typeof diagnosisMaterialities)[number];
export type DiagnosisInterpretationConfidence = (typeof diagnosisInterpretationConfidences)[number];
export type DiagnosisReferenceRole = (typeof diagnosisReferenceRoles)[number];
export type DiagnosisEntityType = (typeof diagnosisEntityTypes)[number];
export type DiagnosisReviewDecision = (typeof diagnosisReviewDecisions)[number];

/** Human-readable definitions shown beside each label on the review surface. */
export const diagnosisLabelDefinitions = {
  grounding: {
    evidence_backed: "Supported by the cited evidence records",
    calculated: "Derived from a software calculation",
    interpretive: "AI interpretation, not fact",
    hypothesis: "Tentative AI hypothesis, not fact",
  },
  materiality: "Could this materially affect the business or its strategy? It does not mean the statement is true.",
  interpretationConfidence: "Confidence in the analytical interpretation only. It is not the probability that anything is true.",
} as const;

/**
 * One diagnosis item as proposed (or corrected), with references still local
 * handles. `headline` exists only on `phase1_diagnosis_v2` items.
 */
export type DiagnosisItemDraft = {
  headline?: string;
  itemType: DiagnosisItemType;
  statement: string;
  rationale: string;
  grounding: DiagnosisGrounding;
  materiality: DiagnosisMateriality;
  interpretationConfidence: DiagnosisInterpretationConfidence | null;
  limitations: string | null;
  references: Array<{ entityType: DiagnosisEntityType; ref: string; role: DiagnosisReferenceRole }>;
};

/** A software-derived value exposed to the model as derived input. */
export type DiagnosisCalculation = {
  handle: string;
  ruleKey: string;
  ruleVersion: string;
  label: string;
  formula: string;
  valueNumeric: string | null;
  valuePrecision: NumericPrecision;
  valueLower: string | null;
  valueUpper: string | null;
  unit: string;
  /** Canonical source records (application-side only). */
  sources: Array<{ entityType: "metric" | "evidence"; id: string }>;
};

/** A validated Evidence Coherence gap carried forward into Phase 1. */
export type CarriedForwardGap = {
  id: string;
  analysisRunId: string;
  area: string;
  missingInformation: string;
  decisionImpact: string;
  materiality: string;
  priorityRank: number;
};
