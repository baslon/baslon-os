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
export const EVIDENCE_COHERENCE_INPUT_VERSION = "evidence_coherence_input_v1";
export const MAX_SURFACED_QUESTIONS = 3;

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
    numericValue: string;
    unit: string;
    periodStart: string | null;
    periodEnd: string | null;
    sourceEvidenceId: string | null;
  }>;
  relationships: Array<{
    claimId: string;
    evidenceId: string;
    relationshipType: string;
    strengthScore: string | null;
  }>;
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
