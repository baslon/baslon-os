export class EvidenceExtractionFailedError extends Error {
  constructor(readonly runId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : "Evidence extraction failed", { cause });
    this.name = "EvidenceExtractionFailedError";
  }
}
