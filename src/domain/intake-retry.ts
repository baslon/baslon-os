import { EvidenceExtractionFailedError } from "@/domain/evidence-extraction-error";

export function evidenceExtractionFailureTarget(businessId: string, error: unknown): string {
  const message = "Evidence extraction failed. Your intake has been preserved so you can retry.";
  const query = new URLSearchParams({ error: message });
  if (error instanceof EvidenceExtractionFailedError) query.set("failedRun", error.runId);
  return `/businesses/${businessId}/intake?${query.toString()}`;
}
