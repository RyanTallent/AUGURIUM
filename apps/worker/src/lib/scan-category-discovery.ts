import {
  DISCOVERY_BUCKET_ORDER,
  discoveryBucketQuota,
  mapToSpecialtyBucket,
  type SpecialtyBucket,
} from "@augurium/shared";
import type { ScanWhaleRow } from "./polymarket-scan.js";

const DEFAULT_MAX = Number(process.env.POLYMARKET_SCAN_WHALE_LIMIT ?? "50");

export interface BalancedWalletPick {
  wallet: string;
  bucket: SpecialtyBucket;
  score: number;
}

function whaleRowScore(row: ScanWhaleRow): number {
  return Number(row.amount_usd ?? 0);
}

/** Build a category-balanced wallet list from scan whales + guaranteed seeds. */
export function buildBalancedScanWalletList(input: {
  whales: ScanWhaleRow[];
  watchlist: string[];
  leaderboard: string[];
  deprioritized?: Set<string>;
  maxWallets?: number;
}): string[] {
  const maxWallets = input.maxWallets ?? DEFAULT_MAX;
  const deprioritized = input.deprioritized ?? new Set<string>();
  const selected = new Set<string>();
  const result: string[] = [];

  const add = (wallet: string) => {
    const w = wallet.toLowerCase();
    if (!w || selected.has(w) || deprioritized.has(w)) return false;
    selected.add(w);
    result.push(w);
    return true;
  };

  for (const w of input.watchlist) add(w);
  for (const w of input.leaderboard) {
    if (result.length >= maxWallets) break;
    add(w);
  }

  const walletBuckets = new Map<string, Map<SpecialtyBucket, number>>();
  const walletScores = new Map<string, number>();

  for (const row of input.whales) {
    if (!row.wallet) continue;
    const w = row.wallet.toLowerCase();
    if (deprioritized.has(w)) continue;
    const bucket = mapToSpecialtyBucket({
      usCategory: row.market_category,
      title: row.market_title,
      slug: row.market_slug,
    });
    const votes = walletBuckets.get(w) ?? new Map();
    votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
    walletBuckets.set(w, votes);
    walletScores.set(w, (walletScores.get(w) ?? 0) + whaleRowScore(row));
  }

  const byBucket = new Map<SpecialtyBucket, BalancedWalletPick[]>();
  for (const [wallet, votes] of walletBuckets) {
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    const pick: BalancedWalletPick = {
      wallet,
      bucket: top[0],
      score: walletScores.get(wallet) ?? 0,
    };
    const list = byBucket.get(top[0]) ?? [];
    list.push(pick);
    byBucket.set(top[0], list);
  }

  for (const bucket of byBucket.keys()) {
    const list = byBucket.get(bucket) ?? [];
    list.sort((a, b) => b.score - a.score);
    byBucket.set(bucket, list);
  }

  for (const bucket of DISCOVERY_BUCKET_ORDER) {
    const quota = discoveryBucketQuota(bucket, maxWallets);
    const picks = byBucket.get(bucket) ?? [];
    let taken = 0;
    for (const pick of picks) {
      if (taken >= quota || result.length >= maxWallets) break;
      if (add(pick.wallet)) taken++;
    }
  }

  const remaining = [...walletScores.entries()]
    .filter(([w]) => !selected.has(w))
    .sort((a, b) => b[1] - a[1]);
  for (const [wallet] of remaining) {
    if (result.length >= maxWallets) break;
    add(wallet);
  }

  return result;
}

export function parseDeprioritizedWallets(
  meta: Record<string, unknown> | null | undefined,
): Set<string> {
  const raw = meta?.deprioritizedWallets;
  if (!raw || typeof raw !== "object") return new Set();
  const now = Date.now();
  const out = new Set<string>();
  for (const [wallet, value] of Object.entries(raw as Record<string, { until?: string }>)) {
    if (!value?.until) continue;
    if (new Date(value.until).getTime() > now) out.add(wallet.toLowerCase());
  }
  return out;
}

export function mergeDeprioritizedWallet(
  meta: Record<string, unknown> | null | undefined,
  wallet: string,
  reason: string,
  days = Number(process.env.COPY_SCAN_DEPRIORITIZE_DAYS ?? "14"),
): Record<string, unknown> {
  const base = { ...(meta ?? {}) };
  const map = { ...((base.deprioritizedWallets as Record<string, unknown>) ?? {}) };
  map[wallet.toLowerCase()] = {
    until: new Date(Date.now() + days * 86400000).toISOString(),
    reason,
  };
  base.deprioritizedWallets = map;
  return base;
}
