import {
  evidenceExtractionOutputSchema,
  type EvidenceExtractionOutput,
} from "@/ai/evidence-extractor/contracts";
import type { NumericPrecision } from "@/domain/numeric-precision";

export class EvidenceExtractionBusinessRuleError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "EvidenceExtractionBusinessRuleError";
  }
}

type NumberMatch = { value: number; index: number; end: number };

function digitMatches(sourceExcerpt: string): NumberMatch[] {
  const numberPattern = /(?<![\p{L}\p{N}_])(-)?\s*([£$€])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([kKmM])?\s*(%)?(?![\p{L}\p{N}_])/gu;
  const matches: NumberMatch[] = [];

  for (const match of sourceExcerpt.matchAll(numberPattern)) {
    const [text, negative, currency, rawNumber, suffix] = match;
    if (suffix?.toLowerCase() === "m" && !currency) continue;

    let value = Number(rawNumber.replaceAll(",", ""));
    if (negative) value *= -1;
    if (suffix?.toLowerCase() === "k") value *= 1_000;
    if (suffix?.toLowerCase() === "m") value *= 1_000_000;
    const index = match.index ?? 0;
    matches.push({ value, index, end: index + text.trimEnd().length });
  }
  return matches;
}

const writtenCardinalValues = new Map<string, number>([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4],
  ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13],
  ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
  ["eighteen", 18], ["nineteen", 19],
]);

const writtenCardinalTens = new Map<string, number>([
  ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90],
]);

const writtenCardinalPattern = /(?<![\p{L}\p{N}_])(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)(?![\p{L}\p{N}_])/giu;

/**
 * Bounded written-number rule (M4-10, stated identically in evidence_extractor_v6/v7):
 * whole-number words from zero to ninety-nine count as explicit numbers, except
 * inside a compound description ("three-day") or after approximation language
 * ("about ten"), which must stay qualitative.
 */
function writtenCardinalMatches(sourceExcerpt: string): NumberMatch[] {
  const matches: NumberMatch[] = [];

  for (const match of sourceExcerpt.matchAll(writtenCardinalPattern)) {
    const text = match[0].toLowerCase();
    const matchIndex = match.index ?? 0;
    const precedingText = sourceExcerpt.slice(0, matchIndex);
    const followingText = sourceExcerpt.slice(matchIndex + match[0].length);

    // A compound such as "three-day" names a qualitative form, not an explicit
    // numeric measurement. Tens compounds such as "twenty-five" are consumed
    // whole by the pattern and therefore remain valid cardinal numbers.
    if (/^-[\p{L}]/u.test(followingText)) continue;

    // Do not turn approximate written language into an exact numeric value.
    if (/\b(?:about|approximately|approx\.?|roughly|around|nearly|almost|circa)\s*$/iu.test(precedingText)) {
      continue;
    }

    const parts = text.split(/[- ]/u);
    const directValue = writtenCardinalValues.get(parts[0]);
    const tensValue = writtenCardinalTens.get(parts[0]);
    const unitValue = parts[1] ? writtenCardinalValues.get(parts[1]) : 0;
    const value = directValue ?? (tensValue !== undefined && unitValue !== undefined ? tensValue + unitValue : undefined);
    if (value !== undefined) {
      matches.push({ value, index: matchIndex, end: matchIndex + match[0].length });
    }
  }

  return matches;
}

function numberMatches(sourceExcerpt: string): NumberMatch[] {
  return [...digitMatches(sourceExcerpt), ...writtenCardinalMatches(sourceExcerpt)]
    .toSorted((left, right) => left.index - right.index);
}

function sameNumber(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-12);
}

export function numericValueIsExplicit(value: number, sourceExcerpt: string): boolean {
  return numberMatches(sourceExcerpt).some((match) => sameNumber(match.value, value));
}

// Language that makes the adjacent number approximate rather than exact.
const approximationBefore = /(?:\b(?:about|approximately|approx\.?|roughly|around|circa|ca\.|c\.|nearly|almost|some|just\s+(?:over|under))|~)\s*$/iu;
const approximationAfter = /^\s*(?:-?\s*ish\b|or\s+so\b|-?\s*odd\b)/iu;
// Language that makes the adjacent number only a limit, which has no valid precision.
const limitBefore = /(?:\b(?:more|less|fewer)\s+than|\b(?:over|under|above|below|up\s+to|upwards\s+of|at\s+(?:least|most)|in\s+excess\s+of|no\s+(?:more|fewer|less)\s+than)|[<>≤≥])\s*$/iu;
const limitAfter = /^\s*(?:\+|or\s+(?:more|less|fewer|over|under|above|below)\b)/iu;
// Language presenting a number as an estimate or belief (checked across the excerpt).
const estimateLanguage = /\b(?:estimat\w*|guess\w*|reckon\w*|probably|(?:i|we)\s+(?:think|believe)|(?:i|we)'d\s+say)\b/iu;
const rangeConnector = /^\s*(?:-|–|—|to)\s*$/iu;

type RangeExpression = { lower: NumberMatch; upper: NumberMatch };

function rangeExpressions(sourceExcerpt: string, matches: NumberMatch[]): RangeExpression[] {
  const ranges: RangeExpression[] = [];
  for (let index = 0; index + 1 < matches.length; index += 1) {
    const [lower, upper] = [matches[index], matches[index + 1]];
    const connector = sourceExcerpt.slice(lower.end, upper.index);
    const isBetween = /\bbetween\s*$/iu.test(sourceExcerpt.slice(0, lower.index))
      && /^\s*and\s*$/iu.test(connector);
    if (rangeConnector.test(connector) || isBetween) ranges.push({ lower, upper });
  }
  return ranges;
}

type Occurrence = "plain" | "approximate" | "limit" | "range";

function classifyOccurrence(sourceExcerpt: string, match: NumberMatch, ranges: RangeExpression[]): Occurrence {
  if (ranges.some((range) => range.lower === match || range.upper === match)) return "range";
  const before = sourceExcerpt.slice(Math.max(0, match.index - 30), match.index);
  const after = sourceExcerpt.slice(match.end, match.end + 14);
  if (approximationBefore.test(before) || approximationAfter.test(after)) return "approximate";
  if (limitBefore.test(before) || limitAfter.test(after)) return "limit";
  return "plain";
}

/**
 * Deterministic grounding of a proposed numeric precision against its excerpt.
 * Fails conservatively: a precision that the wording cannot support is rejected
 * rather than silently downgraded or upgraded.
 */
export function numericPrecisionIssue(input: {
  precision: NumericPrecision | null;
  value: number | null;
  lower: number | null;
  upper: number | null;
  sourceExcerpt: string;
}): string | undefined {
  const { precision, value, lower, upper, sourceExcerpt } = input;
  if (precision === null) return undefined;
  const matches = numberMatches(sourceExcerpt);
  const ranges = rangeExpressions(sourceExcerpt, matches);

  if (precision === "range") {
    const grounded = ranges.some((range) => lower !== null && upper !== null
      && sameNumber(range.lower.value, lower) && sameNumber(range.upper.value, upper));
    return grounded ? undefined
      : `range ${lower}–${upper} is not stated as one range expression in its source excerpt`;
  }
  if (value === null) return undefined;

  const occurrences = matches.filter((match) => sameNumber(match.value, value))
    .map((match) => classifyOccurrence(sourceExcerpt, match, ranges));
  if (occurrences.length === 0) return `numeric value ${value} is not explicitly present in its source excerpt`;

  if (precision === "exact") {
    if (estimateLanguage.test(sourceExcerpt)) return `numeric value ${value} is presented as an estimate, not exact`;
    return occurrences.includes("plain") ? undefined
      : `numeric value ${value} is qualified by approximation, limit or range language, not exact`;
  }
  if (precision === "approximate") {
    return occurrences.includes("approximate") ? undefined
      : `numeric value ${value} has no adjacent approximation language`;
  }
  if (precision === "estimate") {
    if (!estimateLanguage.test(sourceExcerpt)) return `numeric value ${value} has no estimate language in its source excerpt`;
    return occurrences.some((occurrence) => occurrence === "plain" || occurrence === "approximate") ? undefined
      : `numeric value ${value} is a limit or range bound, not an estimate`;
  }
  return undefined;
}

function measurementFamilies(text: string): Set<string> {
  const families = new Set<string>();
  if (/(?:[£$€]\s*\d|\b(?:GBP|USD|EUR)\b)/iu.test(text)) families.add("currency");
  if (/(?:\d(?:[\d,.]*)\s*%|\bpercent(?:age)?\b)/iu.test(text)) families.add("percent");

  const countPattern = /\b\d(?:[\d,.]*)\s*(serious\s+)?(opportunit(?:y|ies)|enquir(?:y|ies)|calls?|projects?|clients?|employees?)\b/giu;
  for (const match of text.matchAll(countPattern)) {
    const noun = match[2].toLowerCase()
      .replace(/ies$/, "y")
      .replace(/s$/, "");
    families.add(`count:${noun}`);
  }
  return families;
}

function hasIncompatibleEvidenceMeasurements(sourceExcerpt: string, unit: string | null): boolean {
  const sourceFamilies = measurementFamilies(sourceExcerpt);
  const unitFamilies = measurementFamilies(unit ?? "");
  const unitAttemptsMultipleValues = /[;|]/u.test(unit ?? "")
    || /\b(?:and|plus)\b/iu.test(unit ?? "");
  return sourceFamilies.size > 1 || unitFamilies.size > 1 || unitAttemptsMultipleValues;
}


export function validateEvidenceExtractionOutput(
  output: unknown,
  rawIntakeText: string,
): EvidenceExtractionOutput {
  const parsed = evidenceExtractionOutputSchema.parse(output);
  const issues: string[] = [];
  const allRefs = [
    ...parsed.claims.map((item) => item.proposalRef),
    ...parsed.evidence.map((item) => item.proposalRef),
    ...parsed.metrics.map((item) => item.proposalRef),
    ...parsed.relationships.map((item) => item.proposalRef),
  ];
  const duplicateRefs = allRefs.filter((ref, index) => allRefs.indexOf(ref) !== index);
  if (duplicateRefs.length > 0) {
    issues.push(`Proposal references must be unique: ${[...new Set(duplicateRefs)].join(", ")}`);
  }

  const claimRefs = new Set(parsed.claims.map((item) => item.proposalRef));
  const evidenceByRef = new Map(parsed.evidence.map((item) => [item.proposalRef, item]));
  for (const relationship of parsed.relationships) {
    if (!claimRefs.has(relationship.claimRef)) {
      issues.push(`${relationship.proposalRef} references missing Claim ${relationship.claimRef}`);
    }
    if (!evidenceByRef.has(relationship.evidenceRef)) {
      issues.push(`${relationship.proposalRef} references missing Evidence ${relationship.evidenceRef}`);
    }
  }
  for (const metric of parsed.metrics) {
    const source = metric.sourceEvidenceRef ? evidenceByRef.get(metric.sourceEvidenceRef) : undefined;
    if (metric.sourceEvidenceRef && !source) {
      issues.push(`${metric.proposalRef} references missing Evidence ${metric.sourceEvidenceRef}`);
    }
    // A Metric must never read as more (or differently) certain than the
    // numeric Evidence it was taken from.
    if (source && source.valuePrecision !== null && source.valuePrecision !== metric.numericPrecision) {
      issues.push(`${metric.proposalRef} precision ${metric.numericPrecision} does not match its source Evidence ${source.proposalRef} precision ${source.valuePrecision}`);
    }
    if (!rawIntakeText.includes(metric.sourceExcerpt)) {
      issues.push(`${metric.proposalRef} source excerpt is not present in the intake`);
    }
    const precisionIssue = numericPrecisionIssue({
      precision: metric.numericPrecision,
      value: metric.numericValue,
      lower: metric.numericLower,
      upper: metric.numericUpper,
      sourceExcerpt: metric.sourceExcerpt,
    });
    if (precisionIssue) issues.push(`${metric.proposalRef} ${precisionIssue}`);
  }
  for (const item of parsed.evidence) {
    if (!rawIntakeText.includes(item.sourceExcerpt)) {
      issues.push(`${item.proposalRef} source excerpt is not present in the intake`);
    }
    const precisionIssue = numericPrecisionIssue({
      precision: item.valuePrecision,
      value: item.valueNumeric,
      lower: item.valueLower,
      upper: item.valueUpper,
      sourceExcerpt: item.sourceExcerpt,
    });
    if (precisionIssue) issues.push(`${item.proposalRef} ${precisionIssue}`);
    if (hasIncompatibleEvidenceMeasurements(item.sourceExcerpt, item.unit)) {
      issues.push(
        `${item.proposalRef} combines independent numeric measurements with incompatible units; create separate Evidence proposals`,
      );
    }
  }

  if (issues.length > 0) throw new EvidenceExtractionBusinessRuleError(issues);
  return parsed;
}
