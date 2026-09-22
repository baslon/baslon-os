import { z } from "zod";
import { DIAGNOSIS_ITEM_REF_PATTERN } from "@/domain/phase1-diagnosis-handles";

/**
 * `diagnosis_headlines_v1`: the model labels statements that a human has
 * already approved. It receives only the approved items to label, by handle,
 * and returns one headline for each. It never re-diagnoses the business and
 * never sees canonical Claims, Evidence or Metrics.
 */
export type DiagnosisHeadlineModelInput = {
  inputVersion: string;
  task: "label_approved_diagnosis_items";
  items: Array<{ itemHandle: string; itemType: string; statement: string }>;
};

export const diagnosisHeadlineProposalSchema = z.object({
  itemHandle: z.string().regex(new RegExp(DIAGNOSIS_ITEM_REF_PATTERN)),
  headline: z.string().trim().min(1),
}).strict();

export const diagnosisHeadlinesOutputSchema = z.object({
  headlines: z.array(diagnosisHeadlineProposalSchema).min(1),
}).strict();

export type DiagnosisHeadlinesOutput = z.output<typeof diagnosisHeadlinesOutputSchema>;

export const diagnosisHeadlinesJsonSchema = z.toJSONSchema(diagnosisHeadlinesOutputSchema);