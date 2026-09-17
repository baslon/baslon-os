import { createHash } from "node:crypto";
import {
  EVIDENCE_COHERENCE_INPUT_VERSION,
  type EvidenceCoherenceProjection,
} from "@/domain/evidence-coherence";

type SnapshotRecord = Record<string, unknown>;

function records(value: unknown): SnapshotRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is SnapshotRecord => Boolean(item) && typeof item === "object")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

export function buildEvidenceCoherenceProjection(snapshot: {
  id: string;
  businessId: string;
  version: number;
  snapshotData: Record<string, unknown>;
}): EvidenceCoherenceProjection {
  const payload = snapshot.snapshotData;
  const snapshotClaims = records(payload.claims);
  const activeClaims = snapshotClaims.filter((claim) => (
    claim.status === "active" && !claim.supersededByClaimId
  ));

  return {
    businessId: snapshot.businessId,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    profile: payload.profile && typeof payload.profile === "object" && !Array.isArray(payload.profile)
      ? payload.profile as Record<string, unknown>
      : {},
    claims: activeClaims.map((claim) => ({
      id: text(claim.id),
      statement: text(claim.statement),
      claimType: text(claim.claimType),
      subjectArea: text(claim.subjectArea),
    })),
    evidence: records(payload.evidence).map((item) => ({
      id: text(item.id),
      statement: text(item.statement),
      valueNumeric: nullableText(item.valueNumeric),
      valueText: nullableText(item.valueText),
      unit: nullableText(item.unit),
      periodStart: nullableText(item.periodStart),
      periodEnd: nullableText(item.periodEnd),
      sourceType: text(item.sourceType),
      sourceReference: nullableText(item.sourceReference),
      reliabilityLevel: text(item.reliabilityLevel),
      directnessLevel: text(item.directnessLevel),
      recencyLevel: text(item.recencyLevel),
      materiality: text(item.materiality),
    })),
    metrics: records(payload.metrics).map((item) => ({
      id: text(item.id),
      metricKey: text(item.metricKey),
      metricLabel: text(item.metricLabel),
      numericValue: text(item.numericValue),
      unit: text(item.unit),
      periodStart: nullableText(item.periodStart),
      periodEnd: nullableText(item.periodEnd),
      sourceEvidenceId: nullableText(item.sourceEvidenceId),
    })),
    relationships: records(payload.claimEvidence).map((item) => ({
      claimId: text(item.claimId),
      evidenceId: text(item.evidenceId),
      relationshipType: text(item.relationshipType),
      strengthScore: nullableText(item.strengthScore),
    })),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableSerializeEvidenceCoherenceProjection(
  projection: EvidenceCoherenceProjection,
): string {
  return JSON.stringify(stableValue(projection));
}

export function hashEvidenceCoherenceProjection(projection: EvidenceCoherenceProjection): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(evidenceCoherenceModelInput(projection))))
    .digest("hex");
}

export function evidenceCoherenceModelInput(projection: EvidenceCoherenceProjection) {
  return {
    projectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
    snapshot: projection,
  };
}
