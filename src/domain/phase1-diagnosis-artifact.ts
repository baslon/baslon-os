import type { DiagnosisReferenceMap } from "@/domain/phase1-diagnosis-handles";
import {
  PHASE1_DIAGNOSIS_ARTIFACT_VERSION,
  type CarriedForwardGap,
  type DiagnosisEntityType,
  type DiagnosisReviewDecision,
} from "@/domain/phase1-diagnosis";
import {
  Phase1DiagnosisContractError,
  parseDiagnosisItem,
  validateDiagnosisItem,
} from "@/domain/phase1-diagnosis-validation";

/** What approval means, recorded inside every artifact (ADR §8.4). */
export const APPROVAL_SEMANTICS = "Approval accepts this diagnosis as the current analytical basis for the next strategic phase. "
  + "It does not make any Claim true, resolve any evidence gap, turn AI interpretation into canonical fact, or approve any recommendation.";

type PersistedReference = {
  role: string;
  claimId: string | null;
  evidenceId: string | null;
  metricId: string | null;
  evidenceGapId: string | null;
  diagnosisCalculationId: string | null;
};

type PersistedItem = {
  id: string;
  itemRef: string;
  itemType: string;
  statement: string;
  rationale: string;
  grounding: string;
  materiality: string;
  interpretationConfidence: string | null;
  limitations: string | null;
  references: PersistedReference[];
};

type PersistedReview = {
  diagnosisItemId: string;
  decision: string;
  correctedPayload: Record<string, unknown> | null;
  reason: string | null;
  reviewedAt: Date;
};

type PersistedCalculation = {
  id: string;
  calculationRef: string;
  ruleKey: string;
  ruleVersion: string;
  label: string;
  formula: string;
  valueNumeric: string | null;
  valuePrecision: string;
  valueLower: string | null;
  valueUpper: string | null;
  unit: string;
  sources: Array<{ metricId: string | null; evidenceId: string | null }>;
};

export function persistedReferenceTarget(reference: PersistedReference): { entityType: DiagnosisEntityType; id: string } {
  if (reference.claimId) return { entityType: "claim", id: reference.claimId };
  if (reference.evidenceId) return { entityType: "evidence", id: reference.evidenceId };
  if (reference.metricId) return { entityType: "metric", id: reference.metricId };
  if (reference.evidenceGapId) return { entityType: "gap", id: reference.evidenceGapId };
  if (reference.diagnosisCalculationId) return { entityType: "calculation", id: reference.diagnosisCalculationId };
  throw new Error("Diagnosis reference has no target");
}

/** Reverse lookup: canonical row → run-local handle. */
export function handleIndex(references: DiagnosisReferenceMap): Map<string, string> {
  return new Map([...references].map(([handle, reference]) => [`${reference.entityType}:${reference.id}`, handle]));
}

export type EffectiveDiagnosisReference = {
  entityType: DiagnosisEntityType;
  handle: string;
  role: string;
  id: string;
  label: string;
};

/** The material values a decided item contributes to an approved diagnosis. */
export type EffectiveDiagnosisItem = {
  itemType: string;
  statement: string;
  rationale: string;
  grounding: string;
  materiality: string;
  interpretationConfidence: string | null;
  limitations: string | null;
  references: EffectiveDiagnosisReference[];
};

/**
 * The effective reviewed item (M4-13): what approval will persist for one
 * decided item. ACCEPTED is the immutable generated item; CORRECTED is the
 * complete corrected payload, revalidated against the run's references;
 * REJECTED contributes nothing (null). The approved-artifact builder and the
 * review page both use this, so a reviewer sees exactly what they approve.
 */
export function effectiveDiagnosisItem(
  item: PersistedItem,
  review: Pick<PersistedReview, "decision" | "correctedPayload">,
  references: DiagnosisReferenceMap,
): EffectiveDiagnosisItem | null {
  if (review.decision === "REJECTED") return null;
  if (review.decision === "CORRECTED") {
    const corrected = parseDiagnosisItem(review.correctedPayload);
    const { issues, resolved } = validateDiagnosisItem(corrected, references, `corrected ${item.itemRef}`);
    if (issues.length) throw new Phase1DiagnosisContractError(issues);
    return {
      ...resolved,
      references: resolved.references.map(({ entityType, ref, role, id, label }) => ({ entityType, handle: ref, role, id, label })),
    };
  }
  if (review.decision !== "ACCEPTED") throw new Error(`Diagnosis item ${item.itemRef} has no valid decision`);
  const handles = handleIndex(references);
  return {
    itemType: item.itemType,
    statement: item.statement,
    rationale: item.rationale,
    grounding: item.grounding,
    materiality: item.materiality,
    interpretationConfidence: item.interpretationConfidence,
    limitations: item.limitations,
    references: item.references.map((reference) => {
      const target = persistedReferenceTarget(reference);
      const handle = handles.get(`${target.entityType}:${target.id}`);
      if (!handle) throw new Error(`Persisted ${target.entityType} ${target.id} is not in this diagnosis input`);
      return { entityType: target.entityType, handle, role: reference.role, id: target.id, label: references.get(handle)!.label };
    }),
  };
}

/**
 * Builds the frozen approved-diagnosis artifact, server-side, from immutable
 * items, validated decisions, deterministic calculations and resolved
 * references. REJECTED items are excluded. CORRECTED values replace the
 * proposal only after passing the same deterministic validation as model
 * output. Carried-forward gaps are always included, so approval cannot
 * silently drop a known gap.
 */
export function buildApprovedDiagnosisArtifact(input: {
  businessId: string;
  run: {
    id: string;
    inputSnapshotId: string;
    inputProjectionVersion: string;
    promptVersion: string;
    inputHash: string;
    provider: string;
    modelIdentifier: string;
    modelConfiguration: Record<string, unknown>;
  };
  snapshotVersion: number;
  reviewSessionId: string;
  reviewer: string;
  approvedAt: Date;
  items: PersistedItem[];
  reviews: PersistedReview[];
  calculations: PersistedCalculation[];
  gaps: Array<CarriedForwardGap & { handle: string }>;
  references: DiagnosisReferenceMap;
}): { artifactVersion: string; content: Record<string, unknown> } {
  const handles = handleIndex(input.references);
  const handleFor = (entityType: DiagnosisEntityType, id: string) => {
    const handle = handles.get(`${entityType}:${id}`);
    if (!handle) throw new Error(`Persisted ${entityType} ${id} is not in this diagnosis input`);
    return handle;
  };
  const reviewByItem = new Map(input.reviews.map((review) => [review.diagnosisItemId, review]));
  const counts: Record<DiagnosisReviewDecision, number> = { ACCEPTED: 0, CORRECTED: 0, REJECTED: 0 };
  const items: Record<string, unknown>[] = [];
  const excluded: Record<string, unknown>[] = [];

  for (const item of input.items.toSorted((left, right) => left.itemRef.localeCompare(right.itemRef))) {
    const review = reviewByItem.get(item.id);
    if (!review || !["ACCEPTED", "CORRECTED", "REJECTED"].includes(review.decision)) {
      throw new Error(`Diagnosis item ${item.itemRef} has no valid decision`);
    }
    const decision = review.decision as DiagnosisReviewDecision;
    counts[decision] += 1;
    const effective = effectiveDiagnosisItem(item, review, input.references);
    if (!effective) {
      excluded.push({ itemRef: item.itemRef, diagnosisItemId: item.id, decision, reason: review.reason });
      continue;
    }
    items.push({ itemRef: item.itemRef, diagnosisItemId: item.id, decision, reason: review.reason, ...effective });
  }

  if (!items.length) throw new Error("An approved diagnosis must contain at least one accepted or corrected item");

  return {
    artifactVersion: PHASE1_DIAGNOSIS_ARTIFACT_VERSION,
    content: {
      artifactVersion: PHASE1_DIAGNOSIS_ARTIFACT_VERSION,
      semantics: APPROVAL_SEMANTICS,
      businessId: input.businessId,
      analysisRunId: input.run.id,
      reviewSessionId: input.reviewSessionId,
      snapshot: {
        id: input.run.inputSnapshotId,
        version: input.snapshotVersion,
        contentHash: input.run.modelConfiguration.snapshotContentHash ?? null,
      },
      inputProjectionVersion: input.run.inputProjectionVersion,
      promptVersion: input.run.promptVersion,
      inputHash: input.run.inputHash,
      provider: input.run.provider,
      model: input.run.modelIdentifier,
      reviewer: input.reviewer,
      approvedAt: input.approvedAt.toISOString(),
      decisions: counts,
      items,
      excludedItems: excluded,
      calculations: input.calculations.map((calculation) => ({
        handle: calculation.calculationRef,
        id: calculation.id,
        derived: true,
        ruleKey: calculation.ruleKey,
        ruleVersion: calculation.ruleVersion,
        label: calculation.label,
        formula: calculation.formula,
        valueNumeric: calculation.valueNumeric,
        valuePrecision: calculation.valuePrecision,
        valueLower: calculation.valueLower,
        valueUpper: calculation.valueUpper,
        unit: calculation.unit,
        sources: calculation.sources.map((source) => source.metricId
          ? { entityType: "metric", id: source.metricId, handle: handleFor("metric", source.metricId) }
          : { entityType: "evidence", id: source.evidenceId!, handle: handleFor("evidence", source.evidenceId!) }),
      })),
      carriedForwardGaps: input.gaps.map((gap) => ({
        handle: gap.handle,
        id: gap.id,
        analysisRunId: gap.analysisRunId,
        area: gap.area,
        materiality: gap.materiality,
        missingInformation: gap.missingInformation,
        decisionImpact: gap.decisionImpact,
      })),
    },
  };
}
