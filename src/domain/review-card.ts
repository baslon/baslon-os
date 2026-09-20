import { formatWorkspaceMetricPeriod } from "@/domain/workspace-metrics";

/**
 * Review-card contract (M4-11). Accept may only persist what the reviewer saw:
 * every proposal field is either shown on the pending card, replaced by
 * application-assigned provenance, or is an internal reference. The manifest
 * below is the single statement of that mapping and is enforced by tests.
 */
export const REVIEW_CARD_VERSION = "m4_11_v1";

export const LEGACY_REVIEW_CARD_WARNING =
  "Qualifiers were AI-assigned and were not all displayed at the original review.";

/** Where a proposal field is visible before Accept, or why it is not persisted from the proposal. */
export type ReviewCardLocation =
  | "headline" | "attributes" | "source" | "numeric" | "endpoints"
  | "details" | "provenance" | "internal";

export type ReviewProposalType = "claim" | "evidence" | "metric" | "claim_evidence";

export const reviewCardManifest: Record<ReviewProposalType, Record<string, ReviewCardLocation>> = {
  claim: {
    proposalRef: "internal",
    statement: "headline",
    claimType: "attributes",
    confidenceLevel: "attributes",
    subjectArea: "details",
    confidenceScore: "details",
    confidenceBasis: "details",
    // Persisted from the extraction run, not from the model (N-1).
    sourceType: "provenance",
  },
  evidence: {
    proposalRef: "internal",
    statement: "headline",
    materiality: "attributes",
    sourceExcerpt: "source",
    valueNumeric: "numeric",
    valuePrecision: "numeric",
    valueLower: "numeric",
    valueUpper: "numeric",
    evidenceType: "details",
    valueText: "details",
    unit: "details",
    periodStart: "details",
    periodEnd: "details",
    reliabilityLevel: "details",
    reliabilityScore: "details",
    directnessLevel: "details",
    recencyLevel: "details",
    // `notes` is an AI-proposed detail; `suppliedBy` is replaced by run provenance.
    sourceMetadata: "details",
    sourceType: "provenance",
    sourceReference: "provenance",
    // Replaced by the application: the validated excerpt plus run and proposal IDs.
    rawPayload: "internal",
  },
  metric: {
    proposalRef: "internal",
    metricLabel: "headline",
    sourceExcerpt: "source",
    numericValue: "numeric",
    numericPrecision: "numeric",
    numericLower: "numeric",
    numericUpper: "numeric",
    metricKey: "details",
    unit: "details",
    periodStart: "details",
    periodEnd: "details",
    dimensionData: "details",
    sourceEvidenceRef: "details",
  },
  claim_evidence: {
    proposalRef: "internal",
    claimRef: "endpoints",
    evidenceRef: "endpoints",
    relationshipType: "endpoints",
    strengthScore: "endpoints",
  },
};

/** Fields that are persisted from application context only and never from a proposal. */
export const applicationDerivedFields = [
  "canonical IDs and timestamps",
  "businessId",
  "evidenceReview lineage (review session, extraction run, proposal, reviewer, review-card version)",
  "rawPayload (validated source excerpt, extraction run ID, proposal ID)",
  "Metric sourceEvidenceId (resolved from the accepted source Evidence)",
  "relationship claimId / evidenceId (resolved from accepted endpoints)",
] as const;

/** Canonical source type used when a run recorded no channel; never model text. */
export const UNRECORDED_SOURCE_TYPE = "unrecorded";

export type ApplicationProvenance = {
  sourceType: string;
  sourceReference: string | null;
  suppliedBy: string | null;
};

/** True provenance comes from the extraction run the application created (N-1). */
export function applicationProvenance(run: {
  sourceType: string | null;
  sourceReference: string | null;
  sourceMetadata: Record<string, unknown> | null;
}): ApplicationProvenance {
  const suppliedBy = run.sourceMetadata?.suppliedBy;
  return {
    sourceType: run.sourceType ?? UNRECORDED_SOURCE_TYPE,
    sourceReference: run.sourceReference,
    suppliedBy: typeof suppliedBy === "string" ? suppliedBy : null,
  };
}

/** Reads the review-card version from a canonical record's JSON lineage. */
export function reviewCardVersionOf(lineageJson: unknown): string | null {
  if (!lineageJson || typeof lineageJson !== "object") return null;
  const review = (lineageJson as Record<string, unknown>).evidenceReview;
  if (!review || typeof review !== "object") return null;
  const version = (review as Record<string, unknown>).reviewCardVersion;
  return typeof version === "string" ? version : null;
}

/** Read-time label for records admitted before the complete review card existed. */
export function legacyReviewCardWarning(lineageJson: unknown): string | null {
  return reviewCardVersionOf(lineageJson) ? null : LEGACY_REVIEW_CARD_WARNING;
}

export type ReviewCardRow = {
  field: string;
  label: string;
  value: string;
  group: "details" | "provenance";
};

function shown(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return String(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Rows for every "details" and "provenance" field of a pending proposal, with the
 * exact values Accept will persist. Provenance comes from the run, not the payload.
 */
export function reviewCardRows(input: {
  proposalType: ReviewProposalType;
  payload: Record<string, unknown>;
  provenance: ApplicationProvenance;
  extractionRunId: string;
  proposalId: string;
  reviewerId?: string | null;
  sourceEvidenceStatement?: string | null;
}): ReviewCardRow[] {
  const { payload, provenance } = input;
  const details = (field: string, label: string, value: unknown): ReviewCardRow =>
    ({ field, label, value: shown(value), group: "details" });
  const lineage: ReviewCardRow[] = [
    { field: "extractionRunId", label: "Extraction run", value: input.extractionRunId, group: "provenance" },
    { field: "proposalId", label: "Proposal", value: input.proposalId, group: "provenance" },
    { field: "reviewerId", label: "Reviewer", value: shown(input.reviewerId), group: "provenance" },
  ];
  const period = (start: unknown, end: unknown) =>
    formatWorkspaceMetricPeriod(typeof start === "string" ? start : null, typeof end === "string" ? end : null);

  if (input.proposalType === "claim") {
    return [
      details("subjectArea", "Subject area", payload.subjectArea),
      details("confidenceScore", "Confidence score", payload.confidenceScore),
      details("confidenceBasis", "Confidence basis", record(payload.confidenceBasis).basis),
      { field: "sourceType", label: "Source type", value: provenance.sourceType, group: "provenance" },
      ...lineage,
    ];
  }
  if (input.proposalType === "evidence") {
    return [
      details("evidenceType", "Evidence type", payload.evidenceType),
      details("valueText", "Value as written", payload.valueText),
      details("unit", "Unit", payload.unit),
      { ...details("periodStart", "Period", period(payload.periodStart, payload.periodEnd)), field: "periodStart" },
      details("reliabilityLevel", "Reliability", payload.reliabilityLevel),
      details("reliabilityScore", "Reliability score", payload.reliabilityScore),
      details("directnessLevel", "Directness", payload.directnessLevel),
      details("recencyLevel", "Recency", payload.recencyLevel),
      details("sourceMetadata", "Source notes", record(payload.sourceMetadata).notes),
      { field: "sourceType", label: "Source type", value: provenance.sourceType, group: "provenance" },
      { field: "sourceReference", label: "Source reference", value: shown(provenance.sourceReference), group: "provenance" },
      { field: "suppliedBy", label: "Supplied by", value: shown(provenance.suppliedBy), group: "provenance" },
      ...lineage,
    ];
  }
  if (input.proposalType === "metric") {
    const dimension = record(payload.dimensionData);
    const sourceRef = payload.sourceEvidenceRef;
    return [
      details("metricKey", "Metric key", payload.metricKey),
      details("unit", "Unit", payload.unit),
      { ...details("periodStart", "Period", period(payload.periodStart, payload.periodEnd)), field: "periodStart" },
      details("dimensionData", "Dimension",
        dimension.dimension || dimension.value ? `${shown(dimension.dimension)}: ${shown(dimension.value)}` : null),
      details("sourceEvidenceRef", "Source Evidence",
        sourceRef ? `${input.sourceEvidenceStatement ?? "Unavailable"} (${String(sourceRef)})` : null),
      ...lineage,
    ];
  }
  return [];
}

/** The fields each row covers, for the manifest invariant (period rows cover both ends). */
export function rowCoverage(row: ReviewCardRow): string[] {
  if (row.field === "periodStart") return ["periodStart", "periodEnd"];
  return [row.field];
}
