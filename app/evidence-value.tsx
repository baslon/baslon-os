import { formatEvidenceNumericSummary } from "@/domain/evidence-presentation";

export function EvidenceValue({
  statement,
  valueNumeric,
  valueText,
  unit,
}: {
  statement: string;
  valueNumeric: string | null;
  valueText: string | null;
  unit: string | null;
}) {
  const numericSummary = formatEvidenceNumericSummary(valueNumeric, unit);
  return <>
    <h3>{statement}</h3>
    {numericSummary ? <p className="metric-value">{numericSummary}</p> : valueNumeric === null && valueText ? <p>{valueText}</p> : null}
  </>;
}
