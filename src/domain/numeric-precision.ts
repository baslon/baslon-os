/**
 * How precisely a numeric value is known, as distinct from the stored number.
 * Numeric storage never upgrades epistemic certainty: a value is `exact` only
 * when the source and human review support it. Records that predate explicit
 * precision are `unspecified`, which must never be read as `exact`.
 *
 * Deterministic calculation rule (for future diagnosis code): a derived result
 * cannot have stronger precision than its least-precise material input, e.g.
 * approximate × exact = approximate; ranges should propagate bounds.
 */
export const numericPrecisions = [
  "exact", "approximate", "estimate", "range", "unspecified",
] as const;

/** Classifications an extractor may propose; `unspecified` is reserved for legacy data and human review. */
export const proposableNumericPrecisions = ["exact", "approximate", "estimate", "range"] as const;

export type NumericPrecision = (typeof numericPrecisions)[number];
export type ProposableNumericPrecision = (typeof proposableNumericPrecisions)[number];

/** Reads precision from stored JSON; anything missing or unknown is `unspecified`. */
export function readNumericPrecision(value: unknown): NumericPrecision {
  return numericPrecisions.includes(value as NumericPrecision)
    ? value as NumericPrecision
    : "unspecified";
}

const labels: Record<NumericPrecision, string> = {
  exact: "Exact",
  approximate: "Approximate",
  estimate: "Estimate",
  range: "Range",
  unspecified: "Unspecified",
};

export function numericPrecisionLabel(precision: NumericPrecision): string {
  return labels[precision];
}

type NumericShape = {
  precision: NumericPrecision | null;
  value: number | null;
  lower: number | null;
  upper: number | null;
};

/**
 * Structural rules shared by proposals, corrections and the database checks:
 * a range has ordered bounds and no single value; exact, approximate and
 * estimate have a single value and no bounds; `unspecified` has no bounds;
 * no precision means no numeric value at all.
 */
export function numericShapeIssue(shape: NumericShape): string | undefined {
  const { precision, value, lower, upper } = shape;
  if (precision === null) {
    return value !== null || lower !== null || upper !== null
      ? "a numeric value or range requires a precision" : undefined;
  }
  if (precision === "range") {
    if (lower === null || upper === null) return "a range requires lower and upper bounds";
    if (lower > upper) return "a range lower bound cannot exceed its upper bound";
    if (value !== null) return "a range cannot also have a single numeric value";
    return undefined;
  }
  if (lower !== null || upper !== null) return `${precision} precision cannot have range bounds`;
  if (precision !== "unspecified" && value === null) return `${precision} precision requires a numeric value`;
  return undefined;
}
