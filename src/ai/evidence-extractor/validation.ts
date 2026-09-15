import {
  evidenceExtractionOutputSchema,
  type EvidenceExtractionOutput,
} from "@/ai/evidence-extractor/contracts";

export class EvidenceExtractionBusinessRuleError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "EvidenceExtractionBusinessRuleError";
  }
}

function numbersExplicitlyPresentIn(sourceExcerpt: string): number[] {
  const numberPattern = /(?<![\p{L}\p{N}_])(-)?\s*([£$€])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([kKmM])?\s*(%)?(?![\p{L}\p{N}_])/gu;
  const values: number[] = [];

  for (const match of sourceExcerpt.matchAll(numberPattern)) {
    const [, negative, currency, rawNumber, suffix] = match;
    if (suffix?.toLowerCase() === "m" && !currency) continue;

    let value = Number(rawNumber.replaceAll(",", ""));
    if (negative) value *= -1;
    if (suffix?.toLowerCase() === "k") value *= 1_000;
    if (suffix?.toLowerCase() === "m") value *= 1_000_000;
    values.push(value);
  }

  return [...values, ...writtenCardinalValuesExplicitlyPresentIn(sourceExcerpt)];
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

function writtenCardinalValuesExplicitlyPresentIn(sourceExcerpt: string): number[] {
  const values: number[] = [];

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
    if (directValue !== undefined) {
      values.push(directValue);
      continue;
    }

    const tensValue = writtenCardinalTens.get(parts[0]);
    const unitValue = parts[1] ? writtenCardinalValues.get(parts[1]) : 0;
    if (tensValue !== undefined && unitValue !== undefined) {
      values.push(tensValue + unitValue);
    }
  }

  return values;
}

export function numericValueIsExplicit(value: number, sourceExcerpt: string): boolean {
  return numbersExplicitlyPresentIn(sourceExcerpt).some((candidate) => {
    const tolerance = Math.max(1e-9, Math.abs(value) * 1e-12);
    return Math.abs(candidate - value) <= tolerance;
  });
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
  const evidenceRefs = new Set(parsed.evidence.map((item) => item.proposalRef));
  for (const relationship of parsed.relationships) {
    if (!claimRefs.has(relationship.claimRef)) {
      issues.push(`${relationship.proposalRef} references missing Claim ${relationship.claimRef}`);
    }
    if (!evidenceRefs.has(relationship.evidenceRef)) {
      issues.push(`${relationship.proposalRef} references missing Evidence ${relationship.evidenceRef}`);
    }
  }
  for (const metric of parsed.metrics) {
    if (metric.sourceEvidenceRef && !evidenceRefs.has(metric.sourceEvidenceRef)) {
      issues.push(`${metric.proposalRef} references missing Evidence ${metric.sourceEvidenceRef}`);
    }
    if (!rawIntakeText.includes(metric.sourceExcerpt)) {
      issues.push(`${metric.proposalRef} source excerpt is not present in the intake`);
    }
    if (!numericValueIsExplicit(metric.numericValue, metric.sourceExcerpt)) {
      issues.push(
        `${metric.proposalRef} numeric value ${metric.numericValue} is not explicitly present in its source excerpt`,
      );
    }
  }
  for (const item of parsed.evidence) {
    if (!rawIntakeText.includes(item.sourceExcerpt)) {
      issues.push(`${item.proposalRef} source excerpt is not present in the intake`);
    }
    if (
      item.valueNumeric !== null
      && !numericValueIsExplicit(item.valueNumeric, item.sourceExcerpt)
    ) {
      issues.push(
        `${item.proposalRef} numeric value ${item.valueNumeric} is not explicitly present in its source excerpt`,
      );
    }
    if (hasIncompatibleEvidenceMeasurements(item.sourceExcerpt, item.unit)) {
      issues.push(
        `${item.proposalRef} combines independent numeric measurements with incompatible units; create separate Evidence proposals`,
      );
    }
  }

  if (issues.length > 0) throw new EvidenceExtractionBusinessRuleError(issues);
  return parsed;
}
