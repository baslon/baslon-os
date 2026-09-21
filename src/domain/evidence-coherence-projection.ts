import { createHash } from "node:crypto";
import {
  EVIDENCE_COHERENCE_INPUT_V2_VERSION,
  EVIDENCE_COHERENCE_INPUT_VERSION,
  type EvidenceCoherenceEntityType,
  type EvidenceCoherenceModelInput,
  type EvidenceCoherenceProjection,
  type EvidenceCoherenceV2ModelInput,
} from "@/domain/evidence-coherence";
import {
  formatHandle,
  type EvidenceCoherenceReference,
  type EvidenceCoherenceReferenceMap,
} from "@/domain/evidence-coherence-handles";
import { readNumericPrecision } from "@/domain/numeric-precision";

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
      // Snapshots written before M4-02A carry no precision and read as unspecified.
      valuePrecision: readNumericPrecision(item.valuePrecision),
      valueLower: nullableText(item.valueLower),
      valueUpper: nullableText(item.valueUpper),
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
      numericValue: nullableText(item.numericValue),
      numericPrecision: readNumericPrecision(item.numericPrecision),
      numericLower: nullableText(item.numericLower),
      numericUpper: nullableText(item.numericUpper),
      unit: text(item.unit),
      periodStart: nullableText(item.periodStart),
      periodEnd: nullableText(item.periodEnd),
      sourceEvidenceId: nullableText(item.sourceEvidenceId),
    })),
    relationships: records(payload.claimEvidence).map((item) => ({
      claimId: text(item.claimId),
      evidenceId: text(item.evidenceId),
      relationshipType: text(item.relationshipType),
      // Preserve the accepted semantic-link confidence without reinterpreting it.
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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

/** Frozen `evidence_coherence_input_v2` hash, kept so historical input hashes stay reproducible. */
export function hashEvidenceCoherenceV2Projection(projection: EvidenceCoherenceProjection): string {
  return sha256(evidenceCoherenceV2ModelInput(projection));
}

/** Frozen `evidence_coherence_input_v2` model input: the projection with canonical UUIDs. */
export function evidenceCoherenceV2ModelInput(
  projection: EvidenceCoherenceProjection,
): EvidenceCoherenceV2ModelInput {
  return {
    projectionVersion: EVIDENCE_COHERENCE_INPUT_V2_VERSION,
    snapshot: projection,
  };
}

/** Input hash under the same normalization as v2: sorted object keys, arrays in projected order. */
export function hashEvidenceCoherenceModelInput(modelInput: EvidenceCoherenceModelInput): string {
  return sha256(modelInput);
}

const snapshotRecordKeys = ["claims", "evidence", "metrics", "claimEvidence"] as const;

/** A snapshot is Business-scoped; a record naming another Business must never enter the reference map. */
function assertSnapshotRecordsBelongToBusiness(snapshot: { id: string; businessId: string; snapshotData: Record<string, unknown> }) {
  for (const key of snapshotRecordKeys) {
    for (const record of records(snapshot.snapshotData[key])) {
      if (record.businessId !== undefined && record.businessId !== snapshot.businessId) {
        throw new Error(`Snapshot ${snapshot.id} contains a ${key} record from another Business`);
      }
    }
  }
}

function admissionTimes(value: unknown): Map<string, number> {
  const times = new Map<string, number>();
  for (const record of records(value)) {
    const time = Date.parse(text(record.createdAt));
    times.set(text(record.id), Number.isNaN(time) ? Number.POSITIVE_INFINITY : time);
  }
  return times;
}

/**
 * Handle ordering rule (evidence_coherence_input_v3): within each entity type,
 * records are ordered by canonical admission time (`createdAt`, earliest first;
 * a record without a readable time sorts last), then by canonical UUID compared
 * as a plain string. The order therefore depends only on snapshot content, never
 * on the array order the snapshot happens to store.
 */
function inAdmissionOrder<T extends { id: string }>(items: T[], times: Map<string, number>): T[] {
  return items.toSorted((left, right) => {
    const leftTime = times.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightTime = times.get(right.id) ?? Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function assignHandles<T extends { id: string }>(
  entityType: EvidenceCoherenceEntityType,
  items: T[],
  references: Map<string, EvidenceCoherenceReference>,
): Map<string, string> {
  const handles = new Map<string, string>();
  items.forEach((item, index) => {
    if (handles.has(item.id)) throw new Error(`Snapshot contains duplicate ${entityType} ${item.id}`);
    const handle = formatHandle(entityType, index + 1);
    handles.set(item.id, handle);
    references.set(handle, { entityType, id: item.id });
  });
  return handles;
}

/**
 * Builds the `evidence_coherence_input_v3` model input for one immutable
 * snapshot, and the application-owned map that resolves its handles back to
 * canonical UUIDs. No canonical UUID is sent to the model. A relationship is
 * projected only when both of its records are projected; one pointing at a
 * superseded Claim has no handle and cannot be cited.
 */
export function buildEvidenceCoherenceModelInput(snapshot: {
  id: string;
  businessId: string;
  version: number;
  snapshotData: Record<string, unknown>;
}): {
  projection: EvidenceCoherenceProjection;
  modelInput: EvidenceCoherenceModelInput;
  references: EvidenceCoherenceReferenceMap;
} {
  assertSnapshotRecordsBelongToBusiness(snapshot);
  const projection = buildEvidenceCoherenceProjection(snapshot);
  const payload = snapshot.snapshotData;
  const references = new Map<string, EvidenceCoherenceReference>();

  const claims = inAdmissionOrder(projection.claims, admissionTimes(payload.claims));
  const evidenceItems = inAdmissionOrder(projection.evidence, admissionTimes(payload.evidence));
  const metricItems = inAdmissionOrder(projection.metrics, admissionTimes(payload.metrics));
  const claimHandles = assignHandles("claim", claims, references);
  const evidenceHandles = assignHandles("evidence", evidenceItems, references);
  const metricHandles = assignHandles("metric", metricItems, references);
  const ordinal = (handle: string) => Number(handle.slice(1));

  const relationships = projection.relationships.flatMap((item) => {
    const claimHandle = claimHandles.get(item.claimId);
    const evidenceHandle = evidenceHandles.get(item.evidenceId);
    return claimHandle && evidenceHandle ? [{
      claimHandle,
      evidenceHandle,
      relationshipType: item.relationshipType,
      strengthScore: item.strengthScore,
    }] : [];
  }).toSorted((left, right) => (
    ordinal(left.claimHandle) - ordinal(right.claimHandle)
    || ordinal(left.evidenceHandle) - ordinal(right.evidenceHandle)
    || (left.relationshipType < right.relationshipType ? -1 : left.relationshipType > right.relationshipType ? 1 : 0)
  ));

  return {
    projection,
    references,
    modelInput: {
      projectionVersion: EVIDENCE_COHERENCE_INPUT_VERSION,
      snapshot: {
        snapshotVersion: projection.snapshotVersion,
        profile: projection.profile,
        claims: claims.map(({ id, ...item }) => ({ handle: claimHandles.get(id)!, ...item })),
        evidence: evidenceItems.map(({ id, ...item }) => ({ handle: evidenceHandles.get(id)!, ...item })),
        metrics: metricItems.map(({ id, sourceEvidenceId, ...item }) => ({
          handle: metricHandles.get(id)!,
          ...item,
          sourceEvidenceHandle: sourceEvidenceId ? evidenceHandles.get(sourceEvidenceId) ?? null : null,
        })),
        relationships,
      },
    },
  };
}
