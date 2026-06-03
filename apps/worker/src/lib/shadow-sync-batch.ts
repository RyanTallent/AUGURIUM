export interface ShadowSyncCandidate {
  id: string;
  status: string;
  priceStatus: string;
  lastPriceUpdateAt: Date | null;
  priceCheckedAt: Date | null;
}

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 2000;

function statusRank(status: string): number {
  return status === "OPEN" ? 0 : 1;
}

function priceStatusRank(priceStatus: string): number {
  if (priceStatus === "STALE") return 0;
  if (priceStatus === "FRESH") return 2;
  return 1;
}

function timeOrZero(d: Date | null | undefined): number {
  return d?.getTime() ?? 0;
}

/** OPEN before CLOSED; STALE before other; oldest price touch first. */
export function compareShadowSyncPriority(
  a: ShadowSyncCandidate,
  b: ShadowSyncCandidate,
): number {
  const sr = statusRank(a.status) - statusRank(b.status);
  if (sr !== 0) return sr;
  const pr = priceStatusRank(a.priceStatus) - priceStatusRank(b.priceStatus);
  if (pr !== 0) return pr;
  const lu = timeOrZero(a.lastPriceUpdateAt) - timeOrZero(b.lastPriceUpdateAt);
  if (lu !== 0) return lu;
  return timeOrZero(a.priceCheckedAt) - timeOrZero(b.priceCheckedAt);
}

export function selectShadowSyncBatch<T extends ShadowSyncCandidate>(
  all: T[],
  batchSize: number,
): T[] {
  const limit = Math.max(1, Math.floor(batchSize));
  if (all.length <= limit) return [...all].sort(compareShadowSyncPriority);
  return [...all].sort(compareShadowSyncPriority).slice(0, limit);
}

/**
 * Batch size for fleet repricing. Uses SHADOW_SYNC_BATCH_SIZE only.
 * SHADOW_MAX_UPDATE is deprecated (was capped at 1 in production and limited the fleet).
 */
export function resolveShadowSyncBatchSize(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SHADOW_SYNC_BATCH_SIZE;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) {
      return Math.min(Math.floor(n), MAX_BATCH_SIZE);
    }
  }
  if (env.SHADOW_MAX_UPDATE != null && env.SHADOW_MAX_UPDATE !== "") {
    console.warn(
      "[shadow:sync] ignoring deprecated SHADOW_MAX_UPDATE; set SHADOW_SYNC_BATCH_SIZE (default 500)",
    );
  }
  return DEFAULT_BATCH_SIZE;
}
