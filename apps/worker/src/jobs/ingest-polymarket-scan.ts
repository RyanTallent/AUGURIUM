import { prisma } from "@augurium/database";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  polymarketScanFetch,
  type ScanTraderBadge,
  type ScanWalletPnlSummary,
  type ScanWhaleRow,
} from "../lib/polymarket-scan.js";
import { scoreTraderUsLiveCompatFast, usLeaderCompatRequired } from "../lib/us-leader-compat.js";

const STREAM_LEADERBOARD = "polymarket-scan:leaderboard";
const WHALE_LIMIT = Number(process.env.POLYMARKET_SCAN_WHALE_LIMIT ?? "50");
const WALLET_BATCH = Number(process.env.POLYMARKET_SCAN_WALLET_BATCH ?? "10");

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
  const maxDrawdown = roi > 0.2 ? 0.08 : roi > 0 ? 0.12 : 0.2;
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
      roi7d: roi * 0.35,
      roi30d: roi * 0.65,
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
  const wallets = new Set<string>();

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
  });
  for (const w of watchlist) wallets.add(w.wallet.toLowerCase());

  const legacy = await polymarketScanFetch<unknown[]>("leaderboard");
  if (legacy.ok && Array.isArray(legacy.data)) {
    for (const row of legacy.data as Array<{ wallet?: string }>) {
      if (row.wallet) wallets.add(row.wallet.toLowerCase());
    }
  }

  const whales = await polymarketScanFetch<ScanWhaleRow[]>("whales", { limit: WHALE_LIMIT });
  await storeRawPayload("polymarket-scan", `whales?limit=${WHALE_LIMIT}`, whales);
  if (whales.ok && whales.data) {
    for (const row of whales.data) {
      if (row.wallet) wallets.add(row.wallet.toLowerCase());
    }
  }

  return [...wallets];
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

  const metricsPass =
    trades >= 15 &&
    rankingScore >= Number(process.env.COPY_MIN_SCORE ?? "72") &&
    roi > 0 &&
    winRate >= 0.5;

  let copyEnabled = metricsPass;
  let disabledReason = metricsPass ? null : "PolymarketScan metrics below COPY threshold";
  const strengths: string[] = copyEnabled ? ["polymarketscan leader"] : [];
  const weaknesses: string[] = copyEnabled ? [] : ["scan metrics below threshold"];

  if (usLeaderCompatRequired()) {
    const usCompat = await scoreTraderUsLiveCompatFast(traderId, wallet);
    if (usCompat.openPositions > 0 && !usCompat.hasTradeableUsPosition) {
      copyEnabled = false;
      disabledReason = `no US-compatible open positions (${usCompat.openPositions} global-only)`;
      weaknesses.push("open positions not tradable on Polymarket US");
    } else if (usCompat.hasTradeableUsPosition) {
      strengths.push(`US-compat positions: ${usCompat.usCompatible}`);
      if (!metricsPass && usCompat.usCompatible > 0 && trades >= 10 && roi > 0) {
        copyEnabled = true;
        disabledReason = null;
        strengths.push("US-compat leader override");
      }
    }
  }

  await prisma.copyTraderControl.upsert({
    where: { traderId },
    create: {
      traderId,
      copyDecision: copyEnabled ? "COPY" : "WATCH",
      copyScore: rankingScore,
      riskScore: Math.max(0, 100 - rankingScore),
      expectedValue: roi,
      enabled: copyEnabled,
      disabledReason,
      strengths,
      weaknesses,
    },
    update: {
      copyDecision: copyEnabled ? "COPY" : "WATCH",
      copyScore: rankingScore,
      riskScore: Math.max(0, 100 - rankingScore),
      expectedValue: roi,
      enabled: copyEnabled,
      disabledReason,
      strengths,
      weaknesses,
      evaluatedAt: new Date(),
    },
  });
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

  for (const wallet of batch) {
    const started = Date.now();
    await upsertTraderFromScan(wallet);
    console.log(`[polymarket-scan] wallet scored ${wallet.slice(0, 10)}… ms=${Date.now() - started}`);
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
