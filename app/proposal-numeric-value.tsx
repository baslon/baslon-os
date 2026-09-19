import {
  readStoredEvidenceProposal,
  readStoredMetricProposal,
} from "@/ai/evidence-extractor/contracts";
import { formatEvidenceNumericSummary } from "@/domain/evidence-presentation";
import { formatWorkspaceMetric } from "@/domain/workspace-metrics";
import { numericPrecisionLabel, type NumericPrecision } from "@/domain/numeric-precision";

const text = (value: number | null) => value === null ? null : String(value);

/** Shows a proposed number or range with its precision before the reviewer decides. */
export function ProposalNumericValue({ proposalType, payload }: {
  proposalType: string;
  payload: unknown;
}) {
  let summary: string | null;
  let precision: NumericPrecision;
  if (proposalType === "evidence") {
    const evidence = readStoredEvidenceProposal(payload);
    if (evidence.valuePrecision === null) return null;
    precision = evidence.valuePrecision;
    summary = formatEvidenceNumericSummary(text(evidence.valueNumeric), evidence.unit, {
      precision,
      lower: text(evidence.valueLower),
      upper: text(evidence.valueUpper),
    }) ?? [evidence.valueNumeric ?? `${evidence.valueLower}–${evidence.valueUpper}`, evidence.unit]
      .filter((part) => part !== null).join(" ");
  } else if (proposalType === "metric") {
    const metric = readStoredMetricProposal(payload);
    precision = metric.numericPrecision;
    summary = formatWorkspaceMetric({
      numericValue: text(metric.numericValue),
      unit: metric.unit,
      numericPrecision: precision,
      numericLower: text(metric.numericLower),
      numericUpper: text(metric.numericUpper),
    });
  } else {
    return null;
  }
  return <div className="numeric-proposal">
    <p className="metric-value">{summary}</p>
    <p><strong>Precision: {numericPrecisionLabel(precision)}</strong></p>
  </div>;
}
