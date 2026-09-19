import type { NumericPrecision } from "@/domain/numeric-precision";

export type WorkspaceMetricPresentation = {
  id: string;
  metricKey: string;
  metricLabel: string;
  numericValue: string | null;
  numericPrecision?: NumericPrecision;
  numericLower?: string | null;
  numericUpper?: string | null;
  unit: string;
  periodStart: string | null;
  periodEnd: string | null;
};

const preferencePattern = /\b(desired?|target|goal|preference|preferred?|aspiration|ideal|lifestyle|working[ -]?week|founder[ _-]?hours?)\b/i;
const performancePattern = /\b(revenue|recurring|mrr|arr|sales|profit|margin|cash|enquir(?:y|ies)|inquir(?:y|ies)|leads?|opportunities|conversion|clients?|customers?|retention|churn|project[ _-]?value|utilisation|utilization|capacity)\b/i;

/**
 * Keeps lifestyle/preferences out of the compact Workspace summary, then ranks
 * recognised commercial and operational outcomes ahead of neutral metrics.
 * Canonical metrics are never changed or removed from Evidence State.
 */
export function selectWorkspaceKeyMetrics<T extends WorkspaceMetricPresentation>(metrics: T[], maximum = 4): T[] {
  return metrics
    .map((metric, index) => ({
      metric,
      index,
      text: `${metric.metricKey} ${metric.metricLabel}`,
    }))
    .filter(({ text }) => !preferencePattern.test(text))
    .map((item) => ({ ...item, score: performancePattern.test(item.text) ? 2 : 1 }))
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maximum)
    .map(({ metric }) => metric);
}

const currencyUnitPattern = /^\s*(?:GBP|£|pounds?)(?:\s*(?:per|\/)\s*(month|year|week|day))?\s*$/i;
const percentUnitPattern = /percent|percentage|%/i;
const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatAmount(value: number, unit: string) {
  const currencyUnit = unit.match(currencyUnitPattern);
  if (currencyUnit) {
    return currencyUnit[1] ? `${gbp.format(value)} / ${currencyUnit[1].toLowerCase()}` : gbp.format(value);
  }
  if (percentUnitPattern.test(unit)) return `${value.toLocaleString("en-GB")}%`;
  return `${value.toLocaleString("en-GB")} ${unit}`.trim();
}

function formatRange(lower: number, upper: number, unit: string) {
  const currencyUnit = unit.match(currencyUnitPattern);
  if (currencyUnit) {
    const range = `${gbp.format(lower)}–${gbp.format(upper)}`;
    return currencyUnit[1] ? `${range} / ${currencyUnit[1].toLowerCase()}` : range;
  }
  const bounds = `${lower.toLocaleString("en-GB")}–${upper.toLocaleString("en-GB")}`;
  if (percentUnitPattern.test(unit)) return `${bounds}%`;
  return `${bounds} ${unit}`.trim();
}

/**
 * Formats a numeric value without implying more precision than it carries:
 * ranges keep both bounds, approximate values read "about …" and estimates are
 * labelled. Exact and unspecified values show the stored number; unspecified
 * precision is labelled separately wherever precision matters.
 */
export function formatWorkspaceMetric(metric: Pick<WorkspaceMetricPresentation, "numericValue" | "unit">
  & Partial<Pick<WorkspaceMetricPresentation, "numericPrecision" | "numericLower" | "numericUpper">>) {
  const precision = metric.numericPrecision ?? "unspecified";
  if (precision === "range" && metric.numericLower != null && metric.numericUpper != null) {
    return formatRange(Number(metric.numericLower), Number(metric.numericUpper), metric.unit);
  }
  if (metric.numericValue === null) return "Value not recorded";
  const amount = formatAmount(Number(metric.numericValue), metric.unit);
  if (precision === "approximate") return `about ${amount}`;
  if (precision === "estimate") return `${amount} (estimate)`;
  return amount;
}

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatWorkspaceMetricPeriod(periodStart: string | null, periodEnd: string | null) {
  if (periodStart && periodEnd) return `${formatDate(periodStart)} – ${formatDate(periodEnd)}`;
  if (periodStart) return `From ${formatDate(periodStart)}`;
  if (periodEnd) return `Until ${formatDate(periodEnd)}`;
  return null;
}
