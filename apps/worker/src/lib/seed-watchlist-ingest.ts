import { prisma } from "@augurium/database";
import { upsertTraderFromWallet } from "../lib/ingestion-store.js";
import {
  polymarketScanFetch,
  type ScanTraderBadge,
  type ScanWalletPnlSummary,
} from "../lib/polymarket-scan.js";

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
      rankingReason: "watchlist seed polymarketscan wallet_pnl",
    },
  });
}

/** Pull PolymarketScan PnL into Trader + metrics snapshot so v1 gates can evaluate. */
export async function ingestWatchlistWalletFromScan(wallet: string): Promise<string> {
  const traderRes = await polymarketScanFetch<{ badges?: ScanTraderBadge[] }>("trader", { wallet });
  const pnlRes = await polymarketScanFetch<{ summary?: ScanWalletPnlSummary | null }>("wallet_pnl", {
    wallet,
  });

  const badges = traderRes.data?.badges ?? [];
  const rankingScore = Math.max(pnlToRanking(pnlRes.data?.summary), badgeScore(badges));
  const roi = Number(pnlRes.data?.summary?.roi ?? pnlRes.data?.summary?.roi_percent ?? 0);
  const winRate = Number(pnlRes.data?.summary?.win_rate ?? 0);
  const trades = Number(pnlRes.data?.summary?.trade_count ?? 0);

  const traderId = await upsertTraderFromWallet(wallet, "polymarket-scan-watchlist");
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
      discoveredVia: "polymarket-scan-watchlist",
      bestCategory: "Sports",
    },
  });

  await upsertScanMetricsSnapshot(traderId, pnlRes.data?.summary, rankingScore);
  return traderId;
}
