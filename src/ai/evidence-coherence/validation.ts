import {
  evidenceCoherenceOutputSchema,
  type EvidenceCoherenceOutput,
} from "@/ai/evidence-coherence/contracts";
import {
  resolveHandle,
  type EvidenceCoherenceReferenceMap,
} from "@/domain/evidence-coherence-handles";

export class EvidenceCoherenceBusinessRuleError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "EvidenceCoherenceBusinessRuleError";
  }
}

const resolutionIssues = {
  malformed: "is not a valid snapshot-local handle",
  wrong_type: "uses a handle outside the declared entity type's namespace",
  unknown: "is not in the analysed snapshot",
} as const;

/**
 * Validates `evidence_coherence_v4` output against the handle map of the exact
 * analysed snapshot and resolves every handle to its canonical UUID. Any invalid
 * reference rejects the whole output, so no finding is partially admitted.
 */
export function validateEvidenceCoherenceOutput(
  output: unknown,
  references: EvidenceCoherenceReferenceMap,
): EvidenceCoherenceOutput {
  const parsed = evidenceCoherenceOutputSchema.parse(output);
  const issues: string[] = [];
  const findings = [...parsed.contradictions, ...parsed.gaps];
  const findingRefs = findings.map((item) => item.findingRef);
  const duplicateFindings = findingRefs.filter((ref, index) => findingRefs.indexOf(ref) !== index);
  if (duplicateFindings.length) issues.push(`Finding references must be unique: ${[...new Set(duplicateFindings)].join(", ")}`);

  const resolved = new Map<(typeof findings)[number], EvidenceCoherenceOutput["gaps"][number]["references"]>();
  for (const finding of findings) {
    const seen = new Set<string>();
    const canonical: EvidenceCoherenceOutput["gaps"][number]["references"] = [];
    for (const reference of finding.references) {
      const key = `${reference.entityType}:${reference.ref}`;
      if (seen.has(key)) issues.push(`${finding.findingRef} contains duplicate reference ${key}`);
      seen.add(key);
      const resolution = resolveHandle(references, reference.entityType, reference.ref);
      if (!resolution.ok) {
        issues.push(`${finding.findingRef} reference ${key} ${resolutionIssues[resolution.issue]}`);
        continue;
      }
      canonical.push({ recordType: reference.entityType, recordId: resolution.id, role: reference.role });
    }
    resolved.set(finding, canonical);
  }

  for (const contradiction of parsed.contradictions) {
    const endpoints = new Set(contradiction.references.map((item) => `${item.entityType}:${item.ref}`));
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
  return {
    contradictions: parsed.contradictions.map((item) => ({ ...item, references: resolved.get(item)! })),
    gaps: parsed.gaps.map((item) => ({ ...item, references: resolved.get(item)! })),
    questions: parsed.questions,
  };
}
