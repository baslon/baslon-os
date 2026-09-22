import { numbersIn, sameNumber } from "@/domain/diagnosis-numbers";

/**
 * A diagnosis headline is a short, human-reviewed presentation label for one
 * approved diagnosis statement. The statement remains the analytical
 * authority: a headline adds no finding, recommendation, rank, priority,
 * number or certainty. These checks are structural and deterministic only;
 * whether a headline faithfully describes its statement is a human judgement.
 */
export const HEADLINE_MAX_LENGTH = 120;

export function headlineStructureIssues(headline: string, label = "headline"): string[] {
  const issues: string[] = [];
  if (!headline.trim()) return [`${label} must not be blank`];
  if (headline !== headline.trim()) issues.push(`${label} must not start or end with whitespace`);
  if (headline.length > HEADLINE_MAX_LENGTH) issues.push(`${label} must be at most ${HEADLINE_MAX_LENGTH} characters`);
  if (/[\r\n]/.test(headline)) issues.push(`${label} must be a single line`);
  if (!/[\p{L}\p{N}]/u.test(headline)) issues.push(`${label} must contain words, not only punctuation`);
  return issues;
}

/** Every number written in the headline must also appear in its statement. */
export function headlineNumberIssues(headline: string, statement: string, label = "headline"): string[] {
  const available = numbersIn(statement);
  return [...new Set(numbersIn(headline))]
    .filter((value) => !available.some((candidate) => sameNumber(candidate, value)))
    .map((value) => `${label} introduces the number ${value}, which is not in the statement`);
}

export function validateHeadline(headline: string, statement: string, label = "headline"): string[] {
  const structure = headlineStructureIssues(headline, label);
  return structure.length && !headline.trim() ? structure : [...structure, ...headlineNumberIssues(headline, statement, label)];
}

/** Conservative normalisation for exact-duplicate detection only; never semantic. */
export function normaliseHeadline(headline: string): string {
  return headline.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

/** Exact duplicates (after normalisation) within one diagnosis or one headline set. */
export function duplicateHeadlineIssues(entries: Array<{ label: string; headline: string }>): string[] {
  const seen = new Map<string, string>();
  const issues: string[] = [];
  for (const entry of entries) {
    const key = normaliseHeadline(entry.headline);
    const first = seen.get(key);
    if (first) issues.push(`${entry.label} repeats the headline of ${first}`);
    else seen.set(key, entry.label);
  }
  return issues;
}
