import type { EvidenceCoherenceHandleProjection } from "@/domain/evidence-coherence";
import type { NumericPrecision } from "@/domain/numeric-precision";
import { formatDiagnosisHandle } from "@/domain/phase1-diagnosis-handles";
import type { DiagnosisCalculation } from "@/domain/phase1-diagnosis";

/**
 * Deterministic diagnosis calculations. Software calculates; AI interprets.
 * Rules are generic over canonical Metric structure. None is keyed to a
 * particular Business or metric key, and a rule produces nothing when its
 * inputs are insufficient.
 */
export const ANNUALISED_RUN_RATE_RULE = { key: "annualised_run_rate", version: "v1" } as const;

const SCALE = 4;
const factor = 10n ** BigInt(SCALE);

/** Exact decimal arithmetic on numeric(20,4) strings; no floating point. */
function toScaled(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported decimal ${value}`);
  const [, sign, whole, fraction = ""] = match;
  const scaled = BigInt(whole) * factor + BigInt(fraction.padEnd(SCALE, "0"));
  return sign === "-" ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / factor;
  const fraction = (magnitude % factor).toString().padStart(SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function multiply(value: string | null, by: bigint): string | null {
  return value === null ? null : fromScaled(toScaled(value) * by);
}

type ProjectedMetric = EvidenceCoherenceHandleProjection["metrics"][number] & { id: string };

/**
 * Multiplying by an exact constant keeps the input's precision class:
 * approximate stays approximate, a range stays a range with both bounds scaled
 * (no midpoint), and unspecified is never upgraded.
 */
function annualisedRunRate(metric: ProjectedMetric): Omit<DiagnosisCalculation, "handle"> | undefined {
  const currency = /^([A-Z]{3}) per month$/.exec(metric.unit.trim());
  if (!currency) return undefined;
  const precision: NumericPrecision = metric.numericPrecision;
  const hasValue = precision === "range"
    ? metric.numericLower !== null && metric.numericUpper !== null
    : metric.numericValue !== null;
  if (!hasValue) return undefined;
  return {
    ruleKey: ANNUALISED_RUN_RATE_RULE.key,
    ruleVersion: ANNUALISED_RUN_RATE_RULE.version,
    label: `Annualised run-rate of ${metric.metricLabel}`,
    formula: `${metric.handle} × 12. The monthly rate annualised; a run-rate, not realised revenue for any period.`,
    valueNumeric: precision === "range" ? null : multiply(metric.numericValue, 12n),
    valuePrecision: precision,
    valueLower: precision === "range" ? multiply(metric.numericLower, 12n) : null,
    valueUpper: precision === "range" ? multiply(metric.numericUpper, 12n) : null,
    unit: `${currency[1]} per year`,
    sources: [{ entityType: "metric", id: metric.id }],
  };
}

/** Calculations in metric-handle order, numbered D001, D002 … */
export function calculateDiagnosisValues(metrics: ProjectedMetric[]): DiagnosisCalculation[] {
  return metrics
    .map(annualisedRunRate)
    .filter((item): item is Omit<DiagnosisCalculation, "handle"> => item !== undefined)
    .map((item, index) => ({ handle: formatDiagnosisHandle("calculation", index + 1), ...item }));
}
