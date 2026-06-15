import { prisma } from "@augurium/database";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  buildBalancedScanWalletList,
  parseDeprioritizedWallets,
} from "../lib/scan-category-discovery.js";
import { discoverWalletsFromUsCatalogOverlap } from "../lib/discover-us-catalog-leaders.js";
import {
  polymarketScanFetch,
  type ScanTraderBadge,
  type ScanWalletPnlSummary,
  type ScanWhaleRow,
} from "../lib/polymarket-scan.js";

const STREAM_LEADERBOARD = "polymarket-scan:leaderboard";
const WHALE_LIMIT = Number(process.env.POLYMARKET_SCAN_WHALE_LIMIT ?? "50");
const WALLET_BATCH = Number(process.env.POLYMARKET_SCAN_WALLET_BATCH ?? "5");
const WALLET_LIST_CACHE_MS = Number(process.env.POLYMARKET_SCAN_WALLET_CACHE_MS ?? "1800000");

function badgeScore(badges: ScanTraderBadge[]): number {
  if (!badges.length) return 0;
  const whale = badges.filter((b) => b.badge_type.includes("whale")).length;
  const insider = badges.filter((b) => b.badge_type.includes("insider")).length;
  return whale * 15 + insider * 10 + badges.length;
}

function pnlToRanking(summary: ScanWalletPnlSummary | null | undefined): number {
  if (!summary) return 0;
  const roi = Number(summary.roi ?? summary.roi_percent ?? 0);
  const pnl = Number(summary.total_pnl ?? summary.realized_pnl ?? 0);
  const winRate = Number(summary.win_rate ?? 0);
  return Math.max(0, roi * 100 + winRate * 20 + Math.log10(Math.max(1, Math.abs(pnl))) * 5);
}

function scanTier(trades: number, winRate: number, roi: number): string {
  if (trades >= 100 && winRate >= 0.6 && roi >= 0.12) return "ELITE";
  if (trades >= 50 && winRate >= 0.55 && roi > 0) return "RISING";
  return "UNRANKED";
}

async function upsertScanMetricsSnapshot(
  traderId: string,
  summary: ScanWalletPnlSummary | null | undefined,
  rankingScore: number,
): Promise<void> {
  const recent = await prisma.traderMetricsSnapshot.findFirst({
    where: {
      traderId,
      capturedAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) return;

  const tradeCount = Math.max(0, Math.floor(Number(summary?.trade_count ?? 0)));
  const winRate = Number(summary?.win_rate ?? 0);
  const roi = Number(summary?.roi ?? summary?.roi_percent ?? 0);
  const realizedPnl = Number(summary?.realized_pnl ?? summary?.total_pnl ?? 0);
  const unrealizedPnl = Number(summary?.unrealized_pnl ?? 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const copyability = Math.min(1, winRate * 0.55 + Math.max(0, roi + 0.05) * 0.45);
  const confidence = Math.min(
    1,
    (tradeCount >= 100 ? 0.55 : tradeCount / 200) + winRate * 0.35 + Math.min(0.1, roi),
  );
  const recentForm = Math.min(1, winRate * 0.7 + Math.max(0, roi) * 0.3);
  // wallet_pnl is lifetime-only — do not deflate period ROI (was blocking v1 heat/lifetime scores)
  const maxDrawdown = roi > 0.15 ? 0.05 : roi > 0 ? 0.08 : roi > -0.05 ? 0.12 : 0.2;
  const tier = scanTier(tradeCount, winRate, roi);

  await prisma.traderMetricsSnapshot.create({
    data: {
      traderId,
      tradeCount,
      marketCount: Math.max(1, Math.floor(tradeCount / 4)),
      totalVolume: Math.abs(totalPnl) * 8,
      activeDays: Math.min(365, Math.max(30, tradeCount)),
      averageTradeSize: tradeCount > 0 ? Math.abs(totalPnl) / tradeCount : 0,
      averagePositionSize: tradeCount > 0 ? Math.abs(totalPnl) / tradeCount : 0,
      realizedPnl,
      unrealizedPnl,
      estimatedTotalPnl: totalPnl,
      roi,
      winRate,
      lossRate: Math.max(0, 1 - winRate),
      averageWin: roi > 0 ? roi * 0.4 : 0,
      averageLoss: roi > 0 ? roi * 0.15 : 0.1,
      profitFactor: winRate > 0 ? winRate / Math.max(0.05, 1 - winRate) : 0,
      maxDrawdown,
      consistencyScore: recentForm,
      roi7d: roi,
      roi30d: roi,
      roi90d: roi,
      roi180d: roi,
      volume7d: 0,
      volume30d: Math.abs(totalPnl),
      tradeCount7d: Math.min(tradeCount, 10),
      tradeCount30d: Math.min(tradeCount, 40),
      copyabilityScore: copyability,
      estimatedCopiedRoi: roi * copyability,
      averageSlippageEstimate: 0.02,
      averageExecutionDelayEstimate: 45,
      mirrorabilityScore: copyability,
      copiedProfitFactor: 1,
      informationEdgeScore: confidence,
      confidenceScore: confidence,
      recentFormScore: recentForm,
      rankingScore,
      tier,
      specialistScore: copyability,
      lowConfidence: tradeCount < 100,
      rankingReason: "polymarketscan wallet_pnl",
    },
  });
}

async function collectLeaderWallets(): Promise<string[]> {
  const cursor = await prisma.syncCursor.findUnique({
    where: { stream: STREAM_LEADERBOARD },
    select: { metadata: true },
  });
  const meta = cursor?.metadata as {
    wallets?: string[];
    walletListCachedAt?: string;
    deprioritizedWallets?: Record<string, { until?: string }>;
  } | null;
  if (meta?.wallets?.length && meta.walletListCachedAt) {
    const age = Date.now() - new Date(meta.walletListCachedAt).getTime();
    if (age < WALLET_LIST_CACHE_MS) {
      console.log(`[polymarket-scan] wallet list cache hit count=${meta.wallets.length}`);
      return meta.wallets;
    }
  }

  const deprioritized = parseDeprioritizedWallets(meta);

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
  });
  const watchlistWallets = watchlist.map((w) => w.wallet.toLowerCase());

  const leaderboardWallets: string[] = [];
  const legacy = await polymarketScanFetch<unknown[]>("leaderboard");
  if (legacy.ok && Array.isArray(legacy.data)) {
    for (const row of legacy.data as Array<{ wallet?: string }>) {
      if (row.wallet) leaderboardWallets.push(row.wallet.toLowerCase());
    }
  }

  const whales = await polymarketScanFetch<ScanWhaleRow[]>("whales", { limit: WHALE_LIMIT });
  await storeRawPayload("polymarket-scan", `whales?limit=${WHALE_LIMIT}`, whales);

  let usOverlapWallets: string[] = [];
  try {
    const overlap = await discoverWalletsFromUsCatalogOverlap();
    usOverlapWallets = overlap.map((w) => w.wallet);
    if (overlap.length > 0) {
      console.log(
        `[polymarket-scan] US-catalog overlap wallets=${overlap.length} top=${overlap[0]?.wallet.slice(0, 10)}… conf=${(overlap[0]?.bestConfidence * 100).toFixed(0)}%`,
      );
    }
  } catch (err) {
    console.warn(
      "[polymarket-scan] US-catalog overlap discovery failed",
      err instanceof Error ? err.message : err,
    );
  }

  const list = buildBalancedScanWalletList({
    whales: whales.ok && whales.data ? whales.data : [],
    watchlist: watchlistWallets,
    leaderboard: leaderboardWallets,
    usOverlapWallets,
    deprioritized,
    maxWallets: WHALE_LIMIT,
  });

  await prisma.syncCursor.update({
    where: { stream: STREAM_LEADERBOARD },
    data: {
      metadata: {
        ...meta,
        wallets: list,
        walletListCachedAt: new Date().toISOString(),
        deprioritizedWallets: meta?.deprioritizedWallets,
      },
    },
  });
  console.log(
    `[polymarket-scan] wallet list refreshed count=${list.length} deprioritized=${deprioritized.size}`,
  );
  return list;
}

async function upsertTraderFromScan(wallet: string): Promise<void> {
  const traderRes = await polymarketScanFetch<{ profile?: unknown; badges?: ScanTraderBadge[] }>(
    "trader",
    { wallet },
  );
  await storeRawPayload("polymarket-scan", `trader?wallet=${wallet}`, traderRes);

  const pnlRes = await polymarketScanFetch<{
    summary?: ScanWalletPnlSummary | null;
  }>("wallet_pnl", { wallet });
  await storeRawPayload("polymarket-scan", `wallet_pnl?wallet=${wallet}`, pnlRes);

  const badges = traderRes.data?.badges ?? [];
  const rankingScore = Math.max(pnlToRanking(pnlRes.data?.summary), badgeScore(badges));
  const roi = Number(pnlRes.data?.summary?.roi ?? 0);
  const winRate = Number(pnlRes.data?.summary?.win_rate ?? 0);
  const trades = Number(pnlRes.data?.summary?.trade_count ?? 0);

  const traderId = await upsertTraderFromWallet(wallet, "polymarket-scan");
  const tier = scanTier(trades, winRate, roi);
  const copyability = Math.min(1, winRate * 0.55 + Math.max(0, roi + 0.05) * 0.45);
  const confidence = Math.min(
    1,
    (trades >= 100 ? 0.55 : trades / 200) + winRate * 0.35 + Math.min(0.1, roi),
  );
  await prisma.trader.update({
    where: { id: traderId },
    data: {
      rankingScore,
      score: rankingScore,
      roi,
      winRate,
      trades: trades > 0 ? trades : undefined,
      tier,
      copyabilityScore: copyability,
      confidenceScore: confidence,
      recentFormScore: Math.min(1, winRate * 0.7 + Math.max(0, roi) * 0.3),
      lowConfidence: trades < 100,
      lastScoredAt: new Date(),
      discoveredVia: "polymarket-scan",
    },
  });

  await upsertScanMetricsSnapshot(traderId, pnlRes.data?.summary, rankingScore);
}

/** PolymarketScan leaderboard/whales → Trader rows + scores (cached in DB). */
export async function ingestPolymarketScanLeaders(): Promise<number> {
  await getOrCreateCursor(STREAM_LEADERBOARD, "batch");
  await markCursorRunning(STREAM_LEADERBOARD);

  const wallets = await collectLeaderWallets();
  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM_LEADERBOARD } });
  const offset = Number.parseInt(cursor.cursorValue, 10) || 0;
  const batch = wallets.slice(offset, offset + WALLET_BATCH);

  if (batch.length === 0) {
    await advanceCursor(STREAM_LEADERBOARD, "0", { resetReason: "end-of-wallet-list" });
    return 0;
  }

  console.log(
    `[polymarket-scan] ingest batch=${batch.length} offset=${offset} total=${wallets.length}`,
  );

  for (const wallet of batch) {
    const started = Date.now();
    try {
      console.log(`[polymarket-scan] wallet start ${wallet.slice(0, 10)}…`);
      await upsertTraderFromScan(wallet);
      console.log(`[polymarket-scan] wallet scored ${wallet.slice(0, 10)}… ms=${Date.now() - started}`);
    } catch (err) {
      console.warn(
        `[polymarket-scan] wallet failed ${wallet.slice(0, 10)}… ms=${Date.now() - started}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const nextOffset = offset + batch.length >= wallets.length ? 0 : offset + batch.length;
  await advanceCursor(STREAM_LEADERBOARD, String(nextOffset), {
    walletTotal: wallets.length,
    processed: batch.length,
  });

  console.log(
    `[polymarket-scan] leaders ingested batch=${batch.length} offset=${offset} totalWallets=${wallets.length}`,
  );
  return batch.length;
}
