import {
  evidenceCoherenceOutputSchema,
  type EvidenceCoherenceOutput,
} from "@/ai/evidence-coherence/contracts";
import type { EvidenceCoherenceProjection } from "@/domain/evidence-coherence";

export class EvidenceCoherenceBusinessRuleError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "EvidenceCoherenceBusinessRuleError";
  }
}

export function validateEvidenceCoherenceOutput(
  output: unknown,
  projection: EvidenceCoherenceProjection,
): EvidenceCoherenceOutput {
  const parsed = evidenceCoherenceOutputSchema.parse(output);
  const issues: string[] = [];
  const claimIds = new Set(projection.claims.map((item) => item.id));
  const evidenceIds = new Set(projection.evidence.map((item) => item.id));
  const metricIds = new Set(projection.metrics.map((item) => item.id));
  const findings = [...parsed.contradictions, ...parsed.gaps];
  const findingRefs = findings.map((item) => item.findingRef);
  const duplicateFindings = findingRefs.filter((ref, index) => findingRefs.indexOf(ref) !== index);
  if (duplicateFindings.length) issues.push(`Finding references must be unique: ${[...new Set(duplicateFindings)].join(", ")}`);

  for (const finding of findings) {
    const seen = new Set<string>();
    for (const reference of finding.references) {
      const key = `${reference.recordType}:${reference.recordId}`;
      if (seen.has(key)) issues.push(`${finding.findingRef} contains duplicate canonical reference ${key}`);
      seen.add(key);
      const exists = reference.recordType === "claim" ? claimIds.has(reference.recordId)
        : reference.recordType === "evidence" ? evidenceIds.has(reference.recordId)
          : metricIds.has(reference.recordId);
      if (!exists) issues.push(`${finding.findingRef} references ${key} outside the analysed snapshot`);
    }
  }

  for (const contradiction of parsed.contradictions) {
    const endpoints = new Set(contradiction.references.map((item) => `${item.recordType}:${item.recordId}`));
    if (endpoints.size < 2) issues.push(`${contradiction.findingRef} requires distinct contradiction endpoints`);
  }

  const questionKeys = new Set<string>();
  for (const question of parsed.questions) {
    const expected = question.findingType === "contradiction"
      ? parsed.contradictions.find((item) => item.findingRef === question.findingRef)
      : parsed.gaps.find((item) => item.findingRef === question.findingRef);
    if (!expected) issues.push(`Question references missing ${question.findingType} ${question.findingRef}`);
    const key = `${question.findingType}:${question.findingRef}:${question.question.toLowerCase()}`;
    if (questionKeys.has(key)) issues.push(`Duplicate question for ${question.findingRef}`);
    questionKeys.add(key);
  }

  if (issues.length) throw new EvidenceCoherenceBusinessRuleError(issues);
  return parsed;
}
