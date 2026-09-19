import { formatEvidenceNumericSummary } from "@/domain/evidence-presentation";
import { numericPrecisionLabel, type NumericPrecision } from "@/domain/numeric-precision";

export function EvidenceValue({
  statement,
  valueNumeric,
  valueText,
  unit,
  valuePrecision = "unspecified",
  valueLower = null,
  valueUpper = null,
}: {
  statement: string;
  valueNumeric: string | null;
  valueText: string | null;
  unit: string | null;
  valuePrecision?: NumericPrecision;
  valueLower?: string | null;
  valueUpper?: string | null;
}) {
  const numericSummary = formatEvidenceNumericSummary(valueNumeric, unit, {
    precision: valuePrecision,
    lower: valueLower,
    upper: valueUpper,
  });
  const hasNumber = valueNumeric !== null || valueLower !== null;
  return <>
    <h3>{statement}</h3>
    {numericSummary ? <p className="metric-value">{numericSummary}</p> : !hasNumber && valueText ? <p>{valueText}</p> : null}
    {hasNumber ? <p className="muted">Precision: {numericPrecisionLabel(valuePrecision)}</p> : null}
  </>;
}
