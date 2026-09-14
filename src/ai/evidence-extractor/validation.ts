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

  return values;
}

export function numericValueIsExplicit(value: number, sourceExcerpt: string): boolean {
  return numbersExplicitlyPresentIn(sourceExcerpt).some((candidate) => {
    const tolerance = Math.max(1e-9, Math.abs(value) * 1e-12);
    return Math.abs(candidate - value) <= tolerance;
  });
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
  }

  if (issues.length > 0) throw new EvidenceExtractionBusinessRuleError(issues);
  return parsed;
}
