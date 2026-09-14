import { formatWorkspaceMetric } from "@/domain/workspace-metrics";

const unambiguousCurrencyUnit = /^\s*(?:GBP|£|pounds?)(?:\s*(?:per|\/)\s*(month|year|week|day))?\s*$/i;
const unambiguousPercentageUnit = /^\s*(?:%|percent|percentage)\s*$/i;
const currencyOrPercentageToken = /(?:\b(?:GBP|pounds?|percent|percentage)\b|£|%)/i;
const compositeSeparator = /(?:[;,|]|\s+(?:and|or)\s+)/i;

export function formatEvidenceNumericSummary(valueNumeric: string | null, unit: string | null) {
  if (valueNumeric === null || unit === null || !Number.isFinite(Number(valueNumeric))) return null;
  if (unambiguousCurrencyUnit.test(unit)) {
    return formatWorkspaceMetric({ numericValue: valueNumeric, unit });
  }
  if (unambiguousPercentageUnit.test(unit)) {
    return `${Number(valueNumeric).toLocaleString("en-GB")}%`;
  }
  if (currencyOrPercentageToken.test(unit) || compositeSeparator.test(unit)) return null;
  return `${Number(valueNumeric).toLocaleString("en-GB")} ${unit}`.trim();
}
