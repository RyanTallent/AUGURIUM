export interface ShadowSyncRunOutcome {
  timedOut: boolean;
  partialTimeout: boolean;
  processed: number;
  selected: number;
}

export function parseShadowSyncRunOutcome(
  run: {
    status: string;
    finishedAt: Date | null;
    itemCount: number | null;
    metadata: unknown;
  } | null,
): ShadowSyncRunOutcome | null {
  if (!run?.metadata || typeof run.metadata !== "object") {
    if (run?.itemCount != null) {
      return {
        timedOut: false,
        partialTimeout: false,
        processed: run.itemCount,
        selected: run.itemCount,
      };
    }
    return null;
  }
  const m = run.metadata as Record<string, unknown>;
  const processed = typeof m.processed === "number" ? m.processed : (run.itemCount ?? 0);
  const selected = typeof m.selected === "number" ? m.selected : processed;
  const timedOut = m.timedOut === true;
  const partialTimeout = timedOut && processed > 0;
  return { timedOut, partialTimeout, processed, selected };
}

/** Partial timeout with progress is acceptable; empty timeout is not. */
export function isShadowSyncRunAcceptable(outcome: ShadowSyncRunOutcome | null): boolean {
  if (!outcome) return true;
  if (!outcome.timedOut) return true;
  return outcome.partialTimeout;
}
