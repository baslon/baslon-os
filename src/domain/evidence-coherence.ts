import type { NumericPrecision } from "@/domain/numeric-precision";

export const analysisRunStatuses = ["RUNNING", "SUCCEEDED", "FAILED"] as const;

export const evidenceQualityAreas = [
  "business_and_offer",
  "customers_and_market",
  "marketing_and_acquisition",
  "sales_and_conversion",
  "delivery_and_capacity",
  "financial_performance",
  "goals_and_constraints",
] as const;

export const findingMaterialities = ["low", "medium", "high"] as const;

export const analysisFindingReferenceRoles = [
  "primary",
  "conflicting",
  "context",
] as const;

export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];
export type EvidenceQualityArea = (typeof evidenceQualityAreas)[number];
export type FindingMateriality = (typeof findingMaterialities)[number];
export type AnalysisFindingReferenceRole =
  (typeof analysisFindingReferenceRoles)[number];

export const EVIDENCE_COHERENCE_MODULE = "evidence_coherence";
export const EVIDENCE_COHERENCE_RUN_TYPE = "snapshot_analysis";
/** Frozen: model input carrying canonical UUIDs, kept so historical runs remain auditable. */
export const EVIDENCE_COHERENCE_INPUT_V2_VERSION = "evidence_coherence_input_v2";
/** Current (M4-12): model input carrying snapshot-local handles instead of canonical UUIDs. */
export const EVIDENCE_COHERENCE_INPUT_VERSION = "evidence_coherence_input_v3";
export const MAX_SURFACED_QUESTIONS = 3;

export const evidenceCoherenceEntityTypes = ["claim", "evidence", "metric"] as const;
export type EvidenceCoherenceEntityType = (typeof evidenceCoherenceEntityTypes)[number];

/**
 * Application-side projection of one immutable snapshot. It carries canonical
 * UUIDs and is never sent to the model under `evidence_coherence_input_v3`.
 */
export type EvidenceCoherenceProjection = {
  businessId: string;
  snapshotId: string;
  snapshotVersion: number;
  profile: Record<string, unknown>;
  claims: Array<{
    id: string;
    statement: string;
    claimType: string;
    subjectArea: string;
  }>;
  evidence: Array<{
    id: string;
    statement: string;
    valueNumeric: string | null;
    /** How precisely the number is known; `unspecified` for records that predate precision. */
    valuePrecision: NumericPrecision;
    valueLower: string | null;
    valueUpper: string | null;
    valueText: string | null;
    unit: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    sourceType: string;
    sourceReference: string | null;
    reliabilityLevel: string;
    directnessLevel: string;
    recencyLevel: string;
    materiality: string;
  }>;
  metrics: Array<{
    id: string;
    metricKey: string;
    metricLabel: string;
    numericValue: string | null;
    numericPrecision: NumericPrecision;
    numericLower: string | null;
    numericUpper: string | null;
    unit: string;
    periodStart: string | null;
    periodEnd: string | null;
    sourceEvidenceId: string | null;
  }>;
  relationships: Array<{
    claimId: string;
    evidenceId: string;
    relationshipType: string;
    /** Semantic-link confidence only; not truth, credibility or proof weight. */
    strengthScore: string | null;
  }>;
};

type Projected<T> = T extends Array<infer Item> ? Item : never;
type WithoutId<T> = Omit<T, "id">;

/**
 * Model-facing snapshot for `evidence_coherence_input_v3` (M4-12). Records are
 * identified only by snapshot-local handles; no canonical UUID is included.
 */
export type EvidenceCoherenceHandleProjection = {
  snapshotVersion: number;
  profile: Record<string, unknown>;
  claims: Array<{ handle: string } & WithoutId<Projected<EvidenceCoherenceProjection["claims"]>>>;
  evidence: Array<{ handle: string } & WithoutId<Projected<EvidenceCoherenceProjection["evidence"]>>>;
  metrics: Array<{ handle: string; sourceEvidenceHandle: string | null }
    & Omit<Projected<EvidenceCoherenceProjection["metrics"]>, "id" | "sourceEvidenceId">>;
  relationships: Array<{
    claimHandle: string;
    evidenceHandle: string;
    relationshipType: string;
    /** Semantic-link confidence only; not truth, credibility or proof weight. */
    strengthScore: string | null;
  }>;
};

/** Model input for `evidence_coherence_input_v3`. */
export type EvidenceCoherenceModelInput = {
  projectionVersion: string;
  snapshot: EvidenceCoherenceHandleProjection;
};

/** Frozen model input for `evidence_coherence_input_v2` (canonical UUIDs). */
export type EvidenceCoherenceV2ModelInput = {
  projectionVersion: string;
  snapshot: EvidenceCoherenceProjection;
};

export type SurfaceableQuestion = {
  id: string;
  question: string;
  priorityOrder: number;
  finding: { materiality: FindingMateriality; priorityRank: number };
};

const materialityOrder: Record<FindingMateriality, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function selectSurfacedQuestions<T extends SurfaceableQuestion>(questions: T[]): T[] {
  return questions
    .filter((item) => item.finding.materiality !== "low")
    .toSorted((left, right) => (
      materialityOrder[left.finding.materiality] - materialityOrder[right.finding.materiality]
      || left.finding.priorityRank - right.finding.priorityRank
      || left.priorityOrder - right.priorityOrder
      || left.id.localeCompare(right.id)
    ))
    .slice(0, MAX_SURFACED_QUESTIONS);
}
