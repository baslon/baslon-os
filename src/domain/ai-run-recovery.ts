const DEFAULT_AI_RUN_STALE_AFTER_MS = 15 * 60 * 1000;

export function aiRunStaleAfterMs(): number {
  const configured = Number(process.env.AI_RUN_STALE_AFTER_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_AI_RUN_STALE_AFTER_MS;
}

export function staleRunCutoff(now = new Date()): Date {
  return new Date(now.getTime() - aiRunStaleAfterMs());
}

export function isAiRunStale(startedAt: Date, now = new Date()): boolean {
  return startedAt.getTime() <= staleRunCutoff(now).getTime();
}

export const staleRunValidationErrors = [{
  code: "stale_run_recovered",
  message: "The prior AI run exceeded the allowed running time and was abandoned before retry.",
}];
