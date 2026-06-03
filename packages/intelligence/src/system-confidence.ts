import { clamp } from "./math.js";
import type { SystemConfidenceInput } from "./types.js";

export interface SystemConfidenceBreakdown {
  score: number;
  coveragePct: number;
  categoryPct: number;
  shadowFreshPct: number;
  tapePct: number;
  ingestHealth: number;
  scoreHealth: number;
  summary: string;
}

export function computeSystemConfidenceScore(input: SystemConfidenceInput): number {
  return computeSystemConfidenceBreakdown(input).score;
}

export function computeSystemConfidenceBreakdown(
  input: SystemConfidenceInput,
): SystemConfidenceBreakdown {
  const {
    totalTrades,
    recentTrades,
    tradesWithScoredTrader,
    scoredTraderCount,
    marketsWithRecentActivity,
    lastTradeAt,
    lastIngestSuccessAt,
    lastScoreSuccessAt,
    categorizedMarketsPct = 0,
    shadowPriceFreshPct = 0,
    tapeCoveragePct = 0,
    now,
  } = input;

  const coverage = recentTrades > 0 ? tradesWithScoredTrader / recentTrades : 0;
  const traderDepth = clamp(scoredTraderCount / 80, 0, 1);
  const marketBreadth = clamp(marketsWithRecentActivity / 30, 0, 1);
  const dataVolume = clamp(totalTrades / 2000, 0, 1);
  const categoryFactor = clamp(categorizedMarketsPct / 100, 0, 1);
  const shadowFactor = clamp(shadowPriceFreshPct / 100, 0, 1);
  const tapeFactor = clamp(tapeCoveragePct / 100, 0, 1);

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
    coverage * 22 +
    traderDepth * 14 +
    marketBreadth * 10 +
    dataVolume * 8 +
    freshness * 12 +
    ingestHealth * 6 +
    scoreHealth * 6 +
    categoryFactor * 8 +
    shadowFactor * 7 +
    tapeFactor * 7;

  const score = clamp(Math.round(raw), 0, 100);

  const warnings: string[] = [];
  if (categorizedMarketsPct < 40) warnings.push("low category coverage");
  if (shadowPriceFreshPct < 25) warnings.push("stale shadow prices");
  if (tapeCoveragePct < 30) warnings.push("thin price tapes");
  if (scoredTraderCount < 50) warnings.push("low scored-trader depth");

  const summary =
    warnings.length > 0
      ? `System ${score}/100 — ${warnings.join(", ")}`
      : `System ${score}/100 — ingestion and evidence healthy`;

  return {
    score,
    coveragePct: Math.round(coverage * 100),
    categoryPct: Math.round(categorizedMarketsPct),
    shadowFreshPct: Math.round(shadowPriceFreshPct),
    tapePct: Math.round(tapeCoveragePct),
    ingestHealth,
    scoreHealth,
    summary,
  };
}
