import type { DiagnosisEntityType } from "@/domain/phase1-diagnosis";

/**
 * Phase 1 Diagnosis local handles, extending the M4-12 pattern with validated
 * gaps (G) and deterministic calculations (D). C/E/M handles are the same ones
 * the Evidence Coherence v3 projection assigns for the same snapshot. The
 * model cites only these; application code resolves them to canonical rows.
 */
export const diagnosisHandlePrefixes = {
  claim: "C",
  evidence: "E",
  metric: "M",
  gap: "G",
  calculation: "D",
} as const satisfies Record<DiagnosisEntityType, string>;

export const PHASE1_DIAGNOSIS_HANDLE_PATTERN = "^[CEMGD](?:[0-9]{3}|[1-9][0-9]{3,})$";
const handlePattern = new RegExp(PHASE1_DIAGNOSIS_HANDLE_PATTERN);

const namespaces = new Map<string, DiagnosisEntityType>(
  Object.entries(diagnosisHandlePrefixes).map(([entityType, prefix]) => [prefix, entityType as DiagnosisEntityType]),
);

export function formatDiagnosisHandle(entityType: DiagnosisEntityType, ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error(`Invalid handle ordinal ${ordinal}`);
  return `${diagnosisHandlePrefixes[entityType]}${String(ordinal).padStart(3, "0")}`;
}

export function diagnosisHandleNamespace(ref: string): DiagnosisEntityType | null {
  return handlePattern.test(ref) ? namespaces.get(ref[0]) ?? null : null;
}

export type DiagnosisReference = {
  entityType: DiagnosisEntityType;
  id: string;
  label: string;
  /** Numeric shape of the record, used only by the precision guards. */
  numeric: {
    precision: string;
    value: number | null;
    lower: number | null;
    upper: number | null;
  } | null;
};

/** Handle → canonical row, built only from one diagnosis run's exact inputs. */
export type DiagnosisReferenceMap = ReadonlyMap<string, DiagnosisReference>;

export type DiagnosisHandleResolution =
  | { ok: true; reference: DiagnosisReference }
  | { ok: false; issue: "malformed" | "wrong_type" | "unknown" };

/** Exact lookup only: no near-match repair, text search or live-state lookup. */
export function resolveDiagnosisHandle(
  references: DiagnosisReferenceMap,
  entityType: DiagnosisEntityType,
  ref: string,
): DiagnosisHandleResolution {
  const namespace = diagnosisHandleNamespace(ref);
  if (!namespace) return { ok: false, issue: "malformed" };
  if (namespace !== entityType) return { ok: false, issue: "wrong_type" };
  const reference = references.get(ref);
  if (!reference || reference.entityType !== entityType) return { ok: false, issue: "unknown" };
  return { ok: true, reference };
}
