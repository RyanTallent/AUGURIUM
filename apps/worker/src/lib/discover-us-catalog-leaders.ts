import { prisma } from "@augurium/database";
import { matchUsMarketFromCatalog } from "@augurium/execution";
import { getUsCompatMinConfidence, mapToSpecialtyBucket } from "@augurium/shared";
import { polymarketScanFetch, type ScanWhaleRow } from "./polymarket-scan.js";

const MIN_CONF = () => getUsCompatMinConfidence();

export interface UsOverlapWallet {
  wallet: string;
  score: number;
  bestConfidence: number;
  globalTitle: string;
  usTitle: string;
  bucket: string;
}

/** Fallback discovery: wallets whose scan activity titles match the US catalog ≥ min confidence. */
export async function discoverWalletsFromUsCatalogOverlap(): Promise<UsOverlapWallet[]> {
  const minConf = MIN_CONF();
  const whalesRes = await polymarketScanFetch<ScanWhaleRow[]>("whales", {
    limit: Number(process.env.POLYMARKET_SCAN_DISCOVERY_WHALE_LIMIT ?? "100"),
  });
  const leaderboardRes = await polymarketScanFetch<Array<{ wallet?: string; market_title?: string }>>(
    "leaderboard",
  );

  const rows: Array<{ wallet: string; title: string }> = [];
  for (const row of whalesRes.data ?? []) {
    if (row.wallet && row.market_title) {
      rows.push({ wallet: row.wallet.toLowerCase(), title: row.market_title });
    }
  }
  for (const row of leaderboardRes.data ?? []) {
    if (row.wallet && row.market_title) {
      rows.push({ wallet: row.wallet.toLowerCase(), title: row.market_title });
    }
  }

  const byWallet = new Map<string, UsOverlapWallet>();

  for (const row of rows) {
    const match = await matchUsMarketFromCatalog({ title: row.title });
    if (!match.slug || match.confidence < minConf) continue;
    const bucket = mapToSpecialtyBucket({ title: row.title });
    const score = match.confidence * 100 + (bucket === "Esports" ? 0 : 10);
    const prev = byWallet.get(row.wallet);
    if (!prev || score > prev.score) {
      byWallet.set(row.wallet, {
        wallet: row.wallet,
        score,
        bestConfidence: match.confidence,
        globalTitle: row.title,
        usTitle: match.usTitle ?? row.title,
        bucket,
      });
    }
  }

  return [...byWallet.values()].sort((a, b) => b.score - a.score);
}

/** Sample active US catalog titles for live-status / ops reporting. */
export async function sampleUsCatalogMarkets(limit = 12): Promise<
  Array<{ title: string; category: string | null; slug: string | null }>
> {
  return prisma.market.findMany({
    where: { source: "polymarket-us", active: true, closed: false },
    select: { title: true, category: true, slug: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}
