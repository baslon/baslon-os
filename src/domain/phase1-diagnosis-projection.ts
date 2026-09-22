import { createHash } from "node:crypto";
import { buildEvidenceCoherenceModelInput } from "@/domain/evidence-coherence-projection";
import type { EvidenceCoherenceHandleProjection } from "@/domain/evidence-coherence";
import { calculateDiagnosisValues } from "@/domain/phase1-diagnosis-calculations";
import {
  formatDiagnosisHandle,
  type DiagnosisReference,
} from "@/domain/phase1-diagnosis-handles";
import {
  PHASE1_DIAGNOSIS_INPUT_VERSION,
  type CarriedForwardGap,
  type DiagnosisCalculation,
} from "@/domain/phase1-diagnosis";

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

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** A record's numeric shape, or null when it carries no number at all. */
export function numericShape(
  precision: string,
  value: string | null,
  lower: string | null,
  upper: string | null,
): DiagnosisReference["numeric"] {
  if (value === null && lower === null && upper === null) return null;
  return { precision, value: toNumber(value), lower: toNumber(lower), upper: toNumber(upper) };
}

/** Adds D handles once calculation rows exist, so D resolves to a persisted row. */
export function withCalculationReferences(
  references: ReadonlyMap<string, DiagnosisReference>,
  calculations: Array<Pick<DiagnosisCalculation, "handle" | "label" | "valuePrecision" | "valueNumeric" | "valueLower" | "valueUpper"> & { id: string }>,
): Map<string, DiagnosisReference> {
  const map = new Map(references);
  for (const item of calculations) {
    map.set(item.handle, {
      entityType: "calculation",
      id: item.id,
      label: item.label,
      numeric: numericShape(item.valuePrecision, item.valueNumeric, item.valueLower, item.valueUpper),
    });
  }
  return map;
}

/** SHA-256 over a key-sorted serialization; arrays keep their deterministic order. */
export function stableSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

/** Model input for `phase1_diagnosis_input_v1`. No canonical UUID is included. */
export type Phase1DiagnosisModelInput = {
  inputVersion: string;
  snapshot: EvidenceCoherenceHandleProjection;
  validatedGaps: Array<{
    handle: string;
    area: string;
    materiality: string;
    missingInformation: string;
    decisionImpact: string;
  }>;
  calculations: Array<{
    handle: string;
    derived: true;
    label: string;
    formula: string;
    valueNumeric: string | null;
    valuePrecision: string;
    valueLower: string | null;
    valueUpper: string | null;
    unit: string;
    sourceHandles: string[];
  }>;
};

export type Phase1DiagnosisInput = {
  modelInput: Phase1DiagnosisModelInput;
  /** C/E/M/G handles. D handles are added once calculation rows exist. */
  references: Map<string, DiagnosisReference>;
  calculations: DiagnosisCalculation[];
  gaps: Array<CarriedForwardGap & { handle: string }>;
  snapshotContentHash: string;
};

/**
 * Builds the diagnosis input for one exact immutable snapshot.
 *
 * - **C/E/M handles** come from the Evidence Coherence v3 projection of the
 *   same snapshot: admission order, then canonical UUID.
 * - **G handles** are the validated gaps, in priority order then gap ID, of
 *   the one Evidence Coherence run the Business continued with.
 * - **D handles** are deterministic calculations over the projected Metrics.
 */
export function buildPhase1DiagnosisInput(input: {
  snapshot: { id: string; businessId: string; version: number; snapshotData: Record<string, unknown> };
  gaps: CarriedForwardGap[];
}): Phase1DiagnosisInput {
  const runIds = new Set(input.gaps.map((gap) => gap.analysisRunId));
  if (runIds.size > 1) throw new Error("Carried-forward gaps must come from one Evidence Coherence run");
  const coherence = buildEvidenceCoherenceModelInput(input.snapshot);
  const snapshot = coherence.modelInput.snapshot;
  const references = new Map<string, DiagnosisReference>();
  for (const claim of snapshot.claims) {
    references.set(claim.handle, {
      entityType: "claim", id: coherence.references.get(claim.handle)!.id, label: claim.statement, numeric: null,
    });
  }
  for (const item of snapshot.evidence) {
    references.set(item.handle, {
      entityType: "evidence", id: coherence.references.get(item.handle)!.id, label: item.statement,
      numeric: numericShape(item.valuePrecision, item.valueNumeric, item.valueLower, item.valueUpper),
    });
  }
  for (const metric of snapshot.metrics) {
    references.set(metric.handle, {
      entityType: "metric", id: coherence.references.get(metric.handle)!.id, label: metric.metricLabel,
      numeric: numericShape(metric.numericPrecision, metric.numericValue, metric.numericLower, metric.numericUpper),
    });
  }

  const gaps = input.gaps
    .toSorted((left, right) => left.priorityRank - right.priorityRank || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((gap, index) => ({ ...gap, handle: formatDiagnosisHandle("gap", index + 1) }));
  for (const gap of gaps) {
    references.set(gap.handle, { entityType: "gap", id: gap.id, label: gap.missingInformation, numeric: null });
  }

  const calculations = calculateDiagnosisValues(snapshot.metrics.map((metric) => ({
    ...metric,
    id: coherence.references.get(metric.handle)!.id,
  })));
  const metricHandleById = new Map(snapshot.metrics.map((metric) => [coherence.references.get(metric.handle)!.id, metric.handle]));

  return {
    references,
    calculations,
    gaps,
    snapshotContentHash: stableSha256(input.snapshot.snapshotData),
    modelInput: {
      inputVersion: PHASE1_DIAGNOSIS_INPUT_VERSION,
      snapshot,
      validatedGaps: gaps.map((gap) => ({
        handle: gap.handle,
        area: gap.area,
        materiality: gap.materiality,
        missingInformation: gap.missingInformation,
        decisionImpact: gap.decisionImpact,
      })),
      calculations: calculations.map((item) => ({
        handle: item.handle,
        derived: true,
        label: item.label,
        formula: item.formula,
        valueNumeric: item.valueNumeric,
        valuePrecision: item.valuePrecision,
        valueLower: item.valueLower,
        valueUpper: item.valueUpper,
        unit: item.unit,
        sourceHandles: item.sources.map((source) => metricHandleById.get(source.id)!),
      })),
    },
  };
}

export function hashPhase1DiagnosisInput(modelInput: Phase1DiagnosisModelInput): string {
  return stableSha256(modelInput);
}
