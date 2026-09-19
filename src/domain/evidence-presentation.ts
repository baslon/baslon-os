import { formatWorkspaceMetric } from "@/domain/workspace-metrics";
import type { NumericPrecision } from "@/domain/numeric-precision";

const unambiguousCurrencyUnit = /^\s*(?:GBP|£|pounds?)(?:\s*(?:per|\/)\s*(month|year|week|day))?\s*$/i;
const unambiguousPercentageUnit = /^\s*(?:%|percent|percentage)\s*$/i;
const currencyOrPercentageToken = /(?:\b(?:GBP|pounds?|percent|percentage)\b|£|%)/i;
const compositeSeparator = /(?:[;,|]|\s+(?:and|or)\s+)/i;

export function formatEvidenceNumericSummary(
  valueNumeric: string | null,
  unit: string | null,
  precision: { precision: NumericPrecision; lower: string | null; upper: string | null } = {
    precision: "unspecified", lower: null, upper: null,
  },
) {
  const isRange = precision.precision === "range" && precision.lower !== null && precision.upper !== null;
  const numbers = isRange ? [precision.lower, precision.upper] : [valueNumeric];
  if (unit === null || numbers.some((value) => value === null || !Number.isFinite(Number(value)))) return null;
  const metric = {
    numericValue: isRange ? null : valueNumeric,
    unit,
    numericPrecision: precision.precision,
    numericLower: precision.lower,
    numericUpper: precision.upper,
  };
  if (unambiguousCurrencyUnit.test(unit)) {
    return formatWorkspaceMetric(metric);
  }
  if (unambiguousPercentageUnit.test(unit)) {
    return formatWorkspaceMetric({ ...metric, unit: "%" });
  }
  if (currencyOrPercentageToken.test(unit) || compositeSeparator.test(unit)) return null;
  return formatWorkspaceMetric(metric);
}
