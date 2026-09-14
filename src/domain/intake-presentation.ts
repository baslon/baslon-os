export type RecoverableExtraction = {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  rawIntakeText: string;
  sourceReference: string | null;
};

export function deriveIntakePresentation(input: {
  latestRun?: RecoverableExtraction;
  hasCanonicalEvidence: boolean;
  hasErrorSignal: boolean;
}) {
  const failedRun = input.latestRun?.status === "FAILED" ? input.latestRun : undefined;
  return {
    heading: input.hasCanonicalEvidence ? "Add more information" : "Tell us about the business",
    returning: input.hasCanonicalEvidence,
    showRetryMessage: Boolean(failedRun || input.hasErrorSignal),
    rawIntakeText: failedRun?.rawIntakeText ?? "",
    sourceReference: failedRun?.sourceReference ?? "",
    submitLabel: failedRun ? "Analyse information again →" : "Analyse information →",
  };
}
