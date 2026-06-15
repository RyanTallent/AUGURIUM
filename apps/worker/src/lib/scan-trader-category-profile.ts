import { evaluateUsCatalogMatch } from "@augurium/execution";
import {
  computeBucketSpecialistScore,
  buildTraderCategoryProfile,
  type CategoryBucketMetric,
  type TraderCategoryProfile,
} from "@augurium/copy-trading";
import { mapToSpecialtyBucket, type SpecialtyBucket } from "@augurium/shared";
import { polymarketScanFetch, type ScanWalletTrade } from "./polymarket-scan.js";

const TRADE_LIMIT = Number(process.env.COPY_CATEGORY_PROFILE_TRADES ?? "80");
const MAX_US_CHECKS = Number(process.env.COPY_CATEGORY_US_CHECKS ?? "5");

function netOpenWithMeta(trades: ScanWalletTrade[]): Array<{
  marketId: string;
  title: string;
  slug: string | null;
  bucket: SpecialtyBucket;
  size: number;
  price: number;
}> {
  const byKey = new Map<
    string,
    { shares: number; cost: number; title: string; slug: string | null; bucket: SpecialtyBucket }
  >();
  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );

  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const bucket = mapToSpecialtyBucket({ title: t.market_question, slug: t.event_slug });
    const row = byKey.get(key) ?? {
      shares: 0,
      cost: 0,
      title: t.market_question,
      slug: t.event_slug ?? null,
      bucket,
    };
    const signed = t.side === "SELL" ? -t.size : t.size;
    if (signed > 0) {
      row.cost += signed * t.price;
      row.shares += signed;
    } else {
      const sell = -signed;
      const avg = row.shares > 0 ? row.cost / row.shares : t.price;
      row.shares = Math.max(0, row.shares - sell);
      row.cost = row.shares * avg;
    }
    byKey.set(key, row);
  }

  return [...byKey.entries()]
    .filter(([, row]) => row.shares > 0.01)
    .map(([key, row]) => ({
      marketId: key.split(":")[0] ?? key,
      title: row.title,
      slug: row.slug,
      bucket: row.bucket,
      size: row.shares,
      price: row.shares > 0 ? row.cost / row.shares : 0,
    }));
}

/** Per-category specialty + US overlap from scan wallet trades. */
export async function buildScanTraderCategoryProfile(
  address: string,
): Promise<TraderCategoryProfile> {
  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet: address,
    limit: TRADE_LIMIT,
  });
  const trades = res.data ?? [];
  if (trades.length === 0) {
    return buildTraderCategoryProfile([]);
  }

  const totalTrades = trades.length;
  const totalVolumeUsd = trades.reduce((s, t) => s + t.size * t.price, 0);
  const openPositions = netOpenWithMeta(trades);

  const bucketStats = new Map<
    SpecialtyBucket,
    {
      tradeCount: number;
      volumeUsd: number;
      wins: number;
      openCount: number;
      openChecks: Array<{ title: string; slug: string | null; marketId: string }>;
    }
  >();

  const ensure = (bucket: SpecialtyBucket) => {
    if (!bucketStats.has(bucket)) {
      bucketStats.set(bucket, {
        tradeCount: 0,
        volumeUsd: 0,
        wins: 0,
        openCount: 0,
        openChecks: [],
      });
    }
    return bucketStats.get(bucket)!;
  };

  for (const t of trades) {
    const bucket = mapToSpecialtyBucket({ title: t.market_question, slug: t.event_slug });
    const row = ensure(bucket);
    row.tradeCount++;
    row.volumeUsd += t.size * t.price;
    if (t.side === "SELL" && t.price > 0.5) row.wins++;
  }

  for (const pos of openPositions) {
    const row = ensure(pos.bucket);
    row.openCount++;
    row.openChecks.push({ title: pos.title, slug: pos.slug, marketId: pos.marketId });
  }

  const metrics: CategoryBucketMetric[] = [];

  for (const [bucket, stats] of bucketStats) {
    let bestUsMatch = 0;
    let usCompatibleOpens = 0;
    const checks = stats.openChecks.slice(0, MAX_US_CHECKS);
    for (const pos of checks) {
      const gate = await evaluateUsCatalogMatch({
        globalMarketId: pos.marketId,
        globalTitle: pos.title,
        globalSlug: pos.slug,
        side: "yes",
        category: null,
      });
      bestUsMatch = Math.max(bestUsMatch, gate.confidence);
      if (gate.allowed && gate.usMarketSlug && gate.confidence >= 0.9) usCompatibleOpens++;
    }

    const winRate = stats.tradeCount > 0 ? stats.wins / stats.tradeCount : 0;
    metrics.push({
      bucket,
      tradeCount: stats.tradeCount,
      openCount: stats.openCount,
      volumeUsd: stats.volumeUsd,
      winRate,
      specialistScore: computeBucketSpecialistScore({
        tradeCount: stats.tradeCount,
        totalTrades,
        volumeUsd: stats.volumeUsd,
        totalVolumeUsd,
        winRate,
      }),
      bestUsMatch,
      usCompatibleOpens,
    });
  }

  return buildTraderCategoryProfile(metrics);
}
