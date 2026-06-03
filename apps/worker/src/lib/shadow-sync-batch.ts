export interface ShadowSyncCandidate {
  id: string;
  status: string;
  priceStatus: string;
  lastPriceUpdateAt: Date | null;
  priceCheckedAt: Date | null;
}

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
  if (all.length <= batchSize) return [...all].sort(compareShadowSyncPriority);
  return [...all].sort(compareShadowSyncPriority).slice(0, batchSize);
}
