import {
  diagnosisHeadlinesOutputSchema,
  type DiagnosisHeadlineModelInput,
} from "@/ai/diagnosis-headlines/contracts";
import { DIAGNOSIS_HEADLINES_PROMPT_VERSION } from "@/ai/diagnosis-headlines/prompt";
import { duplicateHeadlineIssues, validateHeadline } from "@/domain/diagnosis-headline";
import { stableSha256 } from "@/domain/phase1-diagnosis-projection";

/**
 * Companion headlines for an already-approved v1 diagnosis (Diagnosis Item
 * Headline extension). Its own analysis module keeps these runs separate from
 * `phase1_diagnosis`, so a diagnosis lookup can never select one. The approved
 * diagnosis is never modified: a headline set is an additional, versioned,
 * human-approved presentation artifact bound to one exact approved diagnosis.
 */
export const DIAGNOSIS_HEADLINES_MODULE = "diagnosis_headlines";
export const DIAGNOSIS_HEADLINES_RUN_TYPE = "approved_diagnosis_headlines";
export const DIAGNOSIS_HEADLINES_INPUT_VERSION = "diagnosis_headlines_input_v1";
export { DIAGNOSIS_HEADLINES_PROMPT_VERSION };

export const diagnosisHeadlineReviewDecisions = ["ACCEPTED", "CORRECTED"] as const;
export type DiagnosisHeadlineReviewDecision = (typeof diagnosisHeadlineReviewDecisions)[number];

/** One effective (ACCEPTED or CORRECTED) item of an approved diagnosis. */
export type EffectiveApprovedItem = {
  itemRef: string;
  diagnosisItemId: string;
  itemType: string;
  statement: string;
};

export class DiagnosisHeadlineContractError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "DiagnosisHeadlineContractError";
  }
}

/** The effective items of an approved artifact, in approved order. Rejected items are excluded. */
export function effectiveApprovedItems(content: Record<string, unknown>): EffectiveApprovedItem[] {
  const items = (content.items ?? []) as Array<Record<string, unknown>>;
  return items.map((item) => {
    const { itemRef, diagnosisItemId, itemType, statement, decision } = item;
    if (typeof itemRef !== "string" || typeof diagnosisItemId !== "string"
      || typeof itemType !== "string" || typeof statement !== "string") {
      throw new DiagnosisHeadlineContractError(["An approved diagnosis item is missing its handle, id, type or statement"]);
    }
    if (decision !== "ACCEPTED" && decision !== "CORRECTED") {
      throw new DiagnosisHeadlineContractError([`Approved item ${itemRef} has decision ${String(decision)}`]);
    }
    return { itemRef, diagnosisItemId, itemType, statement };
  });
}

/** Minimal model input: the approved statements to label. No canonical record or UUID. */
export function buildHeadlineProposalInput(items: EffectiveApprovedItem[]): DiagnosisHeadlineModelInput {
  return {
    inputVersion: DIAGNOSIS_HEADLINES_INPUT_VERSION,
    task: "label_approved_diagnosis_items",
    items: items.map((item) => ({ itemHandle: item.itemRef, itemType: item.itemType, statement: item.statement })),
  };
}

export function hashHeadlineProposalInput(input: DiagnosisHeadlineModelInput): string {
  return stableSha256(input);
}

export type ValidatedHeadlineProposal = EffectiveApprovedItem & { headline: string };

/**
 * Validates proposal output against the effective approved items: exactly one
 * headline per item, no unknown or duplicate handle, structurally valid,
 * introducing no number the statement does not carry, and no repeated headline.
 * Any issue rejects the whole output; nothing partial is persisted.
 */
export function validateHeadlineProposalOutput(
  output: unknown,
  items: EffectiveApprovedItem[],
): ValidatedHeadlineProposal[] {
  const parsed = diagnosisHeadlinesOutputSchema.parse(output);
  const issues: string[] = [];
  const byHandle = new Map(items.map((item) => [item.itemRef, item]));
  const seen = new Set<string>();
  const proposals: ValidatedHeadlineProposal[] = [];
  for (const proposal of parsed.headlines) {
    const item = byHandle.get(proposal.itemHandle);
    if (!item) {
      issues.push(`${proposal.itemHandle} is not an item of this approved diagnosis`);
      continue;
    }
    if (seen.has(proposal.itemHandle)) {
      issues.push(`${proposal.itemHandle} has more than one proposed headline`);
      continue;
    }
    seen.add(proposal.itemHandle);
    issues.push(...validateHeadline(proposal.headline, item.statement, `${proposal.itemHandle} headline`));
    proposals.push({ ...item, headline: proposal.headline });
  }
  for (const item of items) {
    if (!seen.has(item.itemRef)) issues.push(`${item.itemRef} has no proposed headline`);
  }
  issues.push(...duplicateHeadlineIssues(proposals.map((proposal) => ({ label: `${proposal.itemRef} headline`, headline: proposal.headline }))));
  if (issues.length) throw new DiagnosisHeadlineContractError(issues);
  // Approved order, not model order.
  return items.map((item) => proposals.find((proposal) => proposal.itemRef === item.itemRef)!);
}

/** The final headline of one reviewed proposal: the correction, or the proposal itself. */
export function effectiveHeadline(
  proposal: { headline: string },
  review: { decision: string; correctedHeadline: string | null },
): string {
  if (review.decision === "CORRECTED") {
    if (!review.correctedHeadline) throw new DiagnosisHeadlineContractError(["A corrected headline decision must carry the corrected headline"]);
    return review.correctedHeadline;
  }
  if (review.decision !== "ACCEPTED") throw new DiagnosisHeadlineContractError([`Unsupported headline decision ${review.decision}`]);
  return proposal.headline;
}
