import { z } from "zod";
import { duplicateHeadlineIssues, validateHeadline } from "@/domain/diagnosis-headline";
import { numbersIn, sameNumber as same } from "@/domain/diagnosis-numbers";
import {
  resolveDiagnosisHandle,
  type DiagnosisReference,
  type DiagnosisReferenceMap,
} from "@/domain/phase1-diagnosis-handles";
import type { DiagnosisItemDraft } from "@/domain/phase1-diagnosis";
import type { Phase1DiagnosisContract } from "@/domain/phase1-diagnosis-versions";

export class Phase1DiagnosisContractError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "Phase1DiagnosisContractError";
  }
}

export type ResolvedDiagnosisReference = DiagnosisItemDraft["references"][number] & Pick<DiagnosisReference, "id" | "label">;
export type ResolvedDiagnosisItem = Omit<DiagnosisItemDraft, "references"> & {
  references: ResolvedDiagnosisReference[];
};

const resolutionIssues = {
  malformed: "is not a valid run-local handle",
  wrong_type: "uses a handle outside the declared entity type's namespace",
  unknown: "is not in this diagnosis input",
} as const;

/**
 * Missing-data guardrail. A definitive negative performance verdict ("is
 * unprofitable", "is ineffective") is a factual claim, so it must be
 * evidence-backed or calculated from quantitative primary support.
 * Hedged forms ("may be", "cannot be established") do not match. This is a
 * deterministic lexical backstop; human review remains the semantic check.
 */
const negativeVerdict = new RegExp(
  String.raw`\b(?:is|are|was|were|has been|have been)\s+(?:currently\s+|clearly\s+)?`
  + String.raw`(?:unprofitable|unsuccessful|unsustainable|loss-making|ineffective|inefficient|failing|underperforming|`
  + String.raw`not\s+(?:profitable|effective|working|viable|sustainable))\b`
  + String.raw`|\b(?:makes?|made|is making)\s+(?:a\s+)?loss(?:es)?\b|\b(?:does|do)\s+not\s+work\b`,
  "i",
);

/** M4-06: qualifiers and strengthScore must not become truth weights. */
const qualifierAsTruth = [
  /\bstrength\s?score\b|\brelationship strength\b/i,
  /\b(?:probability|likelihood|chance)\b[^.]{0,60}\b(?:true|correct|accurate|real)\b/i,
  /\b\d{1,3}\s?%\s+(?:likely|probable|certain|chance)\b/i,
  /\b(?:averag|mean|combin|weight|sum|aggregat)\w*\b[^.]{0,40}\b(?:reliability|directness|recency|qualifiers?)\b/i,
];

function exactClaimsIn(text: string): number[] {
  return [...text.matchAll(/\b(?:exactly|precisely)\s+(?:[£$€]\s?)?(\d[\d,]*(?:\.\d+)?)/gi)]
    .map((match) => Number(match[1].replaceAll(",", "")));
}

/**
 * Validates one item, proposed or corrected, against the run's reference map.
 * Returns every issue rather than the first, so a reviewer sees all problems.
 */
export function validateDiagnosisItem(
  draft: DiagnosisItemDraft,
  references: DiagnosisReferenceMap,
  label = "item",
): { issues: string[]; resolved: ResolvedDiagnosisItem } {
  const issues: string[] = [];
  const resolved: ResolvedDiagnosisReference[] = [];
  const seen = new Set<string>();
  for (const reference of draft.references) {
    const key = `${reference.entityType}:${reference.ref}`;
    if (seen.has(key)) issues.push(`${label} contains duplicate reference ${key}`);
    seen.add(key);
    const resolution = resolveDiagnosisHandle(references, reference.entityType, reference.ref);
    if (!resolution.ok) {
      issues.push(`${label} reference ${key} ${resolutionIssues[resolution.issue]}`);
      continue;
    }
    if ((reference.entityType === "gap") !== (reference.role === "limiting_gap")) {
      issues.push(`${label} reference ${key}: only validated gaps may use role limiting_gap, and gaps must use it`);
    }
    resolved.push({ ...reference, id: resolution.reference.id, label: resolution.reference.label });
  }

  const primary = resolved.filter((item) => item.role === "primary");
  if (draft.grounding === "evidence_backed"
    && !primary.some((item) => ["claim", "evidence", "metric"].includes(item.entityType))) {
    issues.push(`${label} is evidence_backed but cites no primary Claim, Evidence or Metric`);
  }
  if (draft.grounding === "calculated" && !primary.some((item) => item.entityType === "calculation")) {
    issues.push(`${label} is calculated but cites no primary calculation`);
  }
  if ((draft.grounding === "interpretive" || draft.grounding === "hypothesis") && !draft.limitations?.trim()) {
    issues.push(`${label} is ${draft.grounding} and must state its limitations`);
  }

  const text = [draft.statement, draft.rationale, draft.limitations ?? ""].join(" ");
  // v2 only: the headline is checked as a label of its own statement. A v1
  // draft has no headline, so v1 validation is unchanged.
  if (draft.headline !== undefined) {
    issues.push(...validateHeadline(draft.headline, draft.statement, `${label} headline`));
    if (negativeVerdict.test(draft.headline) && !negativeVerdict.test(draft.statement)) {
      issues.push(`${label} headline states a negative performance conclusion its statement does not make`);
    }
    if (qualifierAsTruth.some((pattern) => pattern.test(draft.headline!))) {
      issues.push(`${label} headline treats a qualifier, strengthScore or confidence as a truth weight or probability`);
    }
  }
  if (negativeVerdict.test(draft.statement)) {
    const quantitative = primary.some((item) => references.get(item.ref)?.numeric
      && item.entityType !== "claim" && item.entityType !== "gap");
    if (!["evidence_backed", "calculated"].includes(draft.grounding) || !quantitative) {
      issues.push(`${label} states a negative performance conclusion without quantitative primary support; missing data is not evidence of poor performance`);
    }
  }
  if (qualifierAsTruth.some((pattern) => pattern.test(text))) {
    issues.push(`${label} treats a qualifier, strengthScore or confidence as a truth weight or probability`);
  }

  const cited = resolved.map((item) => references.get(item.ref)?.numeric).filter((item) => item !== null && item !== undefined);
  for (const value of exactClaimsIn(text)) {
    if (cited.some((numeric) => numeric.precision !== "exact" && numeric.value !== null && same(numeric.value, value))) {
      issues.push(`${label} presents ${value} as exact although its source is not exact`);
    }
  }
  for (const numeric of cited) {
    if (numeric.precision === "range" && numeric.lower !== null && numeric.upper !== null) {
      const midpoint = (numeric.lower + numeric.upper) / 2;
      if (numbersIn(text).some((value) => same(value, midpoint))) {
        issues.push(`${label} substitutes the midpoint ${midpoint} for a range`);
      }
    }
  }

  const { references: _references, ...fields } = draft;
  void _references;
  return { issues, resolved: { ...fields, references: resolved } };
}

/**
 * Strict parse for a human-corrected item, using the contract of the run it
 * corrects: a v1 correction must not carry a headline, a v2 correction must.
 */
export function parseDiagnosisItem(value: unknown, contract: Phase1DiagnosisContract): DiagnosisItemDraft {
  return contract.itemSchema.parse(value);
}

/**
 * Validates model output against the run's reference map, under the contract
 * of the run's recorded prompt version. Any invalid item rejects the whole
 * output (fail-closed, no partial admission).
 */
export function validatePhase1DiagnosisOutput(
  output: unknown,
  references: DiagnosisReferenceMap,
  contract: Phase1DiagnosisContract,
): ResolvedDiagnosisItem[] {
  const parsed = contract.outputSchema.parse(output);
  const issues: string[] = [];
  const items = parsed.items.map((item, index) => {
    const result = validateDiagnosisItem(item, references, `item ${index + 1}`);
    issues.push(...result.issues);
    return result.resolved;
  });
  if (contract.hasHeadline) {
    issues.push(...duplicateHeadlineIssues(parsed.items.map((item, index) => ({ label: `item ${index + 1} headline`, headline: item.headline ?? "" }))));
  }
  if (issues.length) throw new Phase1DiagnosisContractError(issues);
  return items;
}

export function isContractError(error: unknown): error is Phase1DiagnosisContractError | z.ZodError {
  return error instanceof Phase1DiagnosisContractError || error instanceof z.ZodError;
}
