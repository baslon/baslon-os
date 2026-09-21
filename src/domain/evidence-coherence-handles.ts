import type { EvidenceCoherenceEntityType } from "@/domain/evidence-coherence";

/**
 * M4-12 snapshot-local reference handles. The model cites Claims, Evidence and
 * Metrics by these handles; only application code maps them back to canonical
 * UUIDs. A handle is meaningful only inside the analysis input that assigned it
 * and is never persisted as a canonical reference.
 */
export const handlePrefixes = {
  claim: "C",
  evidence: "E",
  metric: "M",
} as const satisfies Record<EvidenceCoherenceEntityType, string>;

/**
 * One canonical spelling per handle: the namespace letter and a 1-based ordinal
 * zero-padded to at least three digits (C001 … C999, C1000 …). "E13", "E0013",
 * lowercase letters and UUIDs are all malformed.
 */
export const EVIDENCE_COHERENCE_HANDLE_PATTERN = "^[CEM](?:[0-9]{3}|[1-9][0-9]{3,})$";
const handlePattern = new RegExp(EVIDENCE_COHERENCE_HANDLE_PATTERN);

const namespaces = new Map<string, EvidenceCoherenceEntityType>(
  Object.entries(handlePrefixes).map(([entityType, prefix]) => [prefix, entityType as EvidenceCoherenceEntityType]),
);

export function formatHandle(entityType: EvidenceCoherenceEntityType, ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error(`Invalid handle ordinal ${ordinal}`);
  return `${handlePrefixes[entityType]}${String(ordinal).padStart(3, "0")}`;
}

/** The entity type a handle's namespace denotes, or null when the handle is malformed. */
export function handleNamespace(ref: string): EvidenceCoherenceEntityType | null {
  return handlePattern.test(ref) ? namespaces.get(ref[0]) ?? null : null;
}

export type EvidenceCoherenceReference = {
  entityType: EvidenceCoherenceEntityType;
  id: string;
};

/** Handle → canonical record, built only from the exact analysed snapshot. */
export type EvidenceCoherenceReferenceMap = ReadonlyMap<string, EvidenceCoherenceReference>;

export type HandleResolution =
  | { ok: true; id: string }
  | { ok: false; issue: "malformed" | "wrong_type" | "unknown" };

/**
 * Exact lookup only: no near-match repair, no text search and no lookup against
 * live canonical state, so an unmapped handle can never reach another snapshot
 * or Business.
 */
export function resolveHandle(
  references: EvidenceCoherenceReferenceMap,
  entityType: EvidenceCoherenceEntityType,
  ref: string,
): HandleResolution {
  const namespace = handleNamespace(ref);
  if (!namespace) return { ok: false, issue: "malformed" };
  if (namespace !== entityType) return { ok: false, issue: "wrong_type" };
  const reference = references.get(ref);
  if (!reference || reference.entityType !== entityType) return { ok: false, issue: "unknown" };
  return { ok: true, id: reference.id };
}
