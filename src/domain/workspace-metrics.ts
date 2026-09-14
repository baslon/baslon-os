export type WorkspaceMetricPresentation = {
  id: string;
  metricKey: string;
  metricLabel: string;
  numericValue: string;
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

export function formatWorkspaceMetric(metric: Pick<WorkspaceMetricPresentation, "numericValue" | "unit">) {
  const value = Number(metric.numericValue);
  const currencyUnit = metric.unit.match(/^\s*(?:GBP|£|pounds?)(?:\s*(?:per|\/)\s*(month|year|week|day))?\s*$/i);
  if (currencyUnit) {
    const amount = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
    return currencyUnit[1] ? `${amount} / ${currencyUnit[1].toLowerCase()}` : amount;
  }
  if (/percent|percentage|%/i.test(metric.unit)) return `${value.toLocaleString("en-GB")}%`;
  return `${value.toLocaleString("en-GB")} ${metric.unit}`.trim();
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
