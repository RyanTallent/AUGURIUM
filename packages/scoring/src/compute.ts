import type { PositionInput, TapePoint, TradeInput, TraderMetricsResult } from "./types.js";
import { computeCategoryMetrics, pickBestCategory, pickSpecialistCategory } from "./category.js";
import { computeConfidenceScore } from "./confidence.js";
import { computeCopyability } from "./copyability.js";
import { computeInformationEdgeScore } from "./information-edge.js";
import { classifyTier, computeRankingScore } from "./ranking.js";
import {
  computeRealizedRoundTrips,
  maxDrawdownFromTrips,
  profitFactorFromTrips,
  winRateFromTrips,
} from "./round-trips.js";
import { clamp, daysBetween, safeDivide } from "./math.js";

const MIN_TRADES_TO_SCORE = 5;

function windowTrades(trades: TradeInput[], days: number, now: Date): TradeInput[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return trades.filter((t) => t.tradedAt.getTime() >= cutoff);
}

function roiForWindow(
  windowStartMs: number,
  trips: ReturnType<typeof computeRealizedRoundTrips>,
  windowTradesList: TradeInput[],
): number {
  const wTrips = trips.filter((t) => t.closedAt.getTime() >= windowStartMs);
  const pnl = wTrips.reduce((s, t) => s + t.pnl, 0);
  const vol = windowTradesList.reduce((s, t) => s + t.size * t.price, 0);
  return safeDivide(pnl, vol, 0);
}

function consistencyFromTrips(trips: ReturnType<typeof computeRealizedRoundTrips>): number {
  if (trips.length < 3) return 0;
  const wins: number[] = trips.map((t) => (t.won ? 1 : 0));
  const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
  const variance =
    wins.reduce((s, w) => s + (w - mean) ** 2, 0) / Math.max(wins.length - 1, 1);
  return clamp(1 - Math.sqrt(variance) * 2, 0, 1);
}

export function computeTraderMetrics(
  trades: TradeInput[],
  positions: PositionInput[],
  marketTapes: Map<string, TapePoint[]>,
  now = new Date(),
): TraderMetricsResult {
  if (trades.length < MIN_TRADES_TO_SCORE) {
    return emptyResult(`insufficient-trades-${trades.length}`);
  }

  const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const trips = computeRealizedRoundTrips(sorted);
  const totalVolume = sorted.reduce((s, t) => s + t.size * t.price, 0);
  const marketIds = new Set(sorted.map((t) => t.marketId ?? t.conditionId));
  const firstSeen = sorted[0]?.tradedAt ?? null;
  const lastSeen = sorted[sorted.length - 1]?.tradedAt ?? null;
  const activeDays =
    firstSeen && lastSeen
      ? Math.max(1, Math.ceil(daysBetween(firstSeen, lastSeen)) + 1)
      : 0;

  const realizedPnl = trips.reduce((s, t) => s + t.pnl, 0);
  const unrealizedPnl = positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + p.pnl, 0);
  const estimatedTotalPnl = realizedPnl + unrealizedPnl;
  const roi = safeDivide(estimatedTotalPnl, totalVolume, 0);
  const winRate = winRateFromTrips(trips);
  const wins = trips.filter((t) => t.pnl > 0);
  const losses = trips.filter((t) => t.pnl < 0);

  const copy = computeCopyability(sorted, marketTapes, {
    tradeCount: sorted.length,
    totalVolume,
  });
  const informationEdgeScore = computeInformationEdgeScore(sorted, marketTapes);
  const categoryMetrics = computeCategoryMetrics(sorted, trips);
  const { category: specialistCategory, score: specialistScore } =
    pickSpecialistCategory(categoryMetrics);

  const consistencyScore = consistencyFromTrips(trips);
  const confidence = computeConfidenceScore({
    tradeCount: sorted.length,
    activeDays,
    marketCount: marketIds.size,
    totalVolume,
    consistencyScore,
    lastSeen,
    now,
  });
  const confidenceScore = confidence.score;

  const t7 = windowTrades(sorted, 7, now);
  const t30 = windowTrades(sorted, 30, now);
  const t90 = windowTrades(sorted, 90, now);
  const t180 = windowTrades(sorted, 180, now);

  const cutoff30 = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const roi7d = roiForWindow(now.getTime() - 7 * 86400000, trips, t7);
  const roi30d = roiForWindow(cutoff30, trips, t30);
  const roi90d = roiForWindow(now.getTime() - 90 * 86400000, trips, t90);
  const roi180d = roiForWindow(now.getTime() - 180 * 86400000, trips, t180);
  const recentFormScore = clamp((roi30d + 0.15) / 0.35, 0, 1);

  let rankingScore = computeRankingScore({
    estimatedCopiedRoi: copy.estimatedCopiedRoi,
    copyabilityScore: copy.copyabilityScore,
    informationEdgeScore,
    confidenceScore,
    consistencyScore,
    recentFormScore,
  });

  const rankingPenalties: string[] = [];
  if (sorted.length < 25) {
    rankingScore = Math.min(rankingScore, 45);
    rankingPenalties.push("sample<25 trades");
  }
  if (totalVolume < 500) {
    rankingScore = Math.min(rankingScore, 40);
    rankingPenalties.push("volume<$500");
  }
  if (confidenceScore < 0.35) {
    rankingScore = Math.min(rankingScore, 50);
    rankingPenalties.push("low confidence");
  }

  const rankingReason =
    rankingPenalties.length > 0
      ? `Rank ${rankingScore.toFixed(1)} capped: ${rankingPenalties.join(", ")}`
      : `Rank ${rankingScore.toFixed(1)} from copyability-weighted ROI and form`;

  const lowConfidence = confidenceScore < 0.4 || sorted.length < 30;
  const tier = classifyTier({
    tradeCount: sorted.length,
    rankingScore,
    roi30d,
    copyabilityScore: copy.copyabilityScore,
    informationEdgeScore,
    confidenceScore,
    lowConfidence,
  });

  return {
    tradeCount: sorted.length,
    marketCount: marketIds.size,
    totalVolume,
    firstSeen,
    lastSeen,
    activeDays,
    averageTradeSize: safeDivide(totalVolume, sorted.length, 0),
    averagePositionSize: safeDivide(
      positions.reduce((s, p) => s + Math.abs(p.size * p.avgPrice), 0),
      positions.length,
      0,
    ),
    realizedPnl,
    unrealizedPnl,
    estimatedTotalPnl,
    roi,
    winRate,
    lossRate: 1 - winRate,
    averageWin: safeDivide(wins.reduce((s, t) => s + t.pnl, 0), wins.length, 0),
    averageLoss: safeDivide(
      Math.abs(losses.reduce((s, t) => s + t.pnl, 0)),
      losses.length,
      0,
    ),
    profitFactor: profitFactorFromTrips(trips),
    maxDrawdown: maxDrawdownFromTrips(trips),
    consistencyScore,
    roi7d,
    roi30d,
    roi90d,
    roi180d,
    volume7d: t7.reduce((s, t) => s + t.size * t.price, 0),
    volume30d: t30.reduce((s, t) => s + t.size * t.price, 0),
    tradeCount7d: t7.length,
    tradeCount30d: t30.length,
    copyabilityScore: copy.copyabilityScore,
    estimatedCopiedRoi: copy.estimatedCopiedRoi,
    averageSlippageEstimate: copy.averageSlippageEstimate,
    averageExecutionDelayEstimate: copy.averageExecutionDelayEstimate,
    mirrorabilityScore: copy.mirrorabilityScore,
    copiedProfitFactor: copy.copiedProfitFactor,
    informationEdgeScore,
    confidenceScore,
    recentFormScore,
    rankingScore,
    tier,
    bestCategory: pickBestCategory(categoryMetrics),
    specialistCategory,
    specialistScore,
    lowConfidence,
    skipReason: null,
    confidenceReason: confidence.reason,
    rankingReason,
    copyabilityReason: copy.reason,
    categoryMetrics,
  };
}

function emptyResult(reason: string): TraderMetricsResult {
  return {
    tradeCount: 0,
    marketCount: 0,
    totalVolume: 0,
    firstSeen: null,
    lastSeen: null,
    activeDays: 0,
    averageTradeSize: 0,
    averagePositionSize: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    estimatedTotalPnl: 0,
    roi: 0,
    winRate: 0,
    lossRate: 0,
    averageWin: 0,
    averageLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    consistencyScore: 0,
    roi7d: 0,
    roi30d: 0,
    roi90d: 0,
    roi180d: 0,
    volume7d: 0,
    volume30d: 0,
    tradeCount7d: 0,
    tradeCount30d: 0,
    copyabilityScore: 0,
    estimatedCopiedRoi: 0,
    averageSlippageEstimate: 0,
    averageExecutionDelayEstimate: 0,
    mirrorabilityScore: 0,
    copiedProfitFactor: 0,
    informationEdgeScore: 0,
    confidenceScore: 0,
    recentFormScore: 0,
    rankingScore: 0,
    tier: "UNRANKED",
    bestCategory: null,
    specialistCategory: null,
    specialistScore: 0,
    lowConfidence: true,
    skipReason: reason,
    confidenceReason: reason,
    rankingReason: reason,
    copyabilityReason: reason,
    categoryMetrics: [],
  };
}
