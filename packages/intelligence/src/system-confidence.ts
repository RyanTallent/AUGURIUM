import { clamp } from "./math.js";
import type { SystemConfidenceInput } from "./types.js";

export function computeSystemConfidenceScore(input: SystemConfidenceInput): number {
  const {
    totalTrades,
    recentTrades,
    tradesWithScoredTrader,
    scoredTraderCount,
    marketsWithRecentActivity,
    lastTradeAt,
    lastIngestSuccessAt,
    lastScoreSuccessAt,
    now,
  } = input;

  const coverage =
    recentTrades > 0 ? tradesWithScoredTrader / recentTrades : 0;
  const traderDepth = clamp(scoredTraderCount / 50, 0, 1);
  const marketBreadth = clamp(marketsWithRecentActivity / 30, 0, 1);
  const dataVolume = clamp(totalTrades / 1000, 0, 1);

  let freshness = 0;
  if (lastTradeAt) {
    const hours = (now.getTime() - lastTradeAt.getTime()) / (3600 * 1000);
    freshness = clamp(1 - hours / 72, 0, 1);
  }

  let ingestHealth = 0.5;
  if (lastIngestSuccessAt) {
    const hours = (now.getTime() - lastIngestSuccessAt.getTime()) / (3600 * 1000);
    ingestHealth = hours < 6 ? 1 : hours < 24 ? 0.7 : 0.3;
  }

  let scoreHealth = 0.5;
  if (lastScoreSuccessAt) {
    const hours = (now.getTime() - lastScoreSuccessAt.getTime()) / (3600 * 1000);
    scoreHealth = hours < 12 ? 1 : hours < 48 ? 0.65 : 0.35;
  }

  const raw =
    coverage * 30 +
    traderDepth * 20 +
    marketBreadth * 15 +
    dataVolume * 10 +
    freshness * 15 +
    ingestHealth * 5 +
    scoreHealth * 5;

  return clamp(raw, 0, 100);
}
