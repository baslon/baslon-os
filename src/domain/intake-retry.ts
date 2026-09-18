import type { InitialIntakeAvailability } from "@/domain/initial-intake";

export function evidenceExtractionFailureTarget(businessId: string, _error: unknown): string {
  void _error;
  const message = "Analysis wasn't completed. Your information has been saved.";
  const query = new URLSearchParams({ error: message });
  return `/businesses/${businessId}/intake?${query.toString()}`;
}

export function initialIntakeUnavailableTarget(
  businessId: string,
  availability: Exclude<InitialIntakeAvailability, { kind: "available" }>,
): string {
  if (availability.kind === "review_in_progress") {
    return `/businesses/${businessId}/reviews/${availability.runId}`;
  }
  if (availability.kind === "use_add_information") return `/businesses/${businessId}/information`;
  if (availability.kind === "analysis_running") return `/businesses/${businessId}/intake`;
  return `/businesses/${businessId}`;
}
