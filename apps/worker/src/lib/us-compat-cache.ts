import type { UsLeaderCompatScore } from "./us-leader-compat.js";
import { scoreTraderUsLiveCompat } from "./us-leader-compat.js";

const TTL_MS = Number(process.env.COPY_US_COMPAT_CACHE_MS ?? "1800000");

type CompatCacheEntry = {
  score: UsLeaderCompatScore;
  at: number;
};

const byTrader = new Map<string, CompatCacheEntry>();

export function getCachedUsCompat(traderId: string): UsLeaderCompatScore | null {
  const row = byTrader.get(traderId);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    byTrader.delete(traderId);
    return null;
  }
  return row.score;
}

export function setCachedUsCompat(traderId: string, score: UsLeaderCompatScore): void {
  byTrader.set(traderId, { score, at: Date.now() });
}

export function invalidateUsCompat(traderId: string): void {
  byTrader.delete(traderId);
}

/** Cached US compat — reuse fresh results to cut DB/API load on fast cycles. */
export async function scoreTraderUsLiveCompatCached(
  traderId: string,
  address: string,
  opts?: { catalogOnly?: boolean; allowScanFetch?: boolean; force?: boolean },
): Promise<UsLeaderCompatScore> {
  if (!opts?.force) {
    const cached = getCachedUsCompat(traderId);
    if (cached) return cached;
  }
  const score = await scoreTraderUsLiveCompat(traderId, address, {
    catalogOnly: opts?.catalogOnly ?? true,
    allowScanFetch: opts?.allowScanFetch ?? false,
  });
  setCachedUsCompat(traderId, score);
  return score;
}
