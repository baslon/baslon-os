export function evidenceExtractionFailureTarget(businessId: string, _error: unknown): string {
  void _error;
  const message = "Analysis wasn't completed. Your information has been saved.";
  const query = new URLSearchParams({ error: message });
  return `/businesses/${businessId}/intake?${query.toString()}`;
}
