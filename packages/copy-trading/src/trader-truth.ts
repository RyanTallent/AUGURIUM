import type { Trader, TraderMetricsSnapshot } from "@augurium/database";

export interface TraderTruthMetrics {
  address: string;
  traderId: string;
  tier: string;
  realizedRoi: number;
  unrealizedRoi: number;
  winRate: number;
  averageReturn: number;
  medianReturn: number;
  maxDrawdown: number;
  consistencyScore: number;
  volatility: number;
  specialization: string | null;
  categorySpecialization: string | null;
  confidenceScore: number;
  copyabilityScore: number;
  tradeCount: number;
  volume30d: number;
  roi7d: number;
  roi30d: number;
  roi90d: number;
  formTrend: "improving" | "stable" | "deteriorating" | "unknown";
  traderExpectedValue: number;
  traderRiskScore: number;
  traderCopyScore: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function volatilityFromRoi(roi7d: number, roi30d: number, roi90d: number): number {
  const samples = [roi7d, roi30d, roi90d].filter((x) => Number.isFinite(x));
  if (samples.length < 2) return 0.15;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance =
    samples.reduce((s, x) => s + (x - mean) ** 2, 0) / (samples.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function formTrend(
  roi7d: number,
  roi30d: number,
  recentFormScore: number,
): TraderTruthMetrics["formTrend"] {
  if (roi7d > roi30d + 0.03 && recentFormScore > 0.55) return "improving";
  if (roi7d < roi30d - 0.05 || recentFormScore < 0.35) return "deteriorating";
  if (Math.abs(roi7d - roi30d) < 0.02) return "stable";
  return "unknown";
}

export function buildTraderTruth(
  trader: Pick<
    Trader,
    | "id"
    | "address"
    | "tier"
    | "copyabilityScore"
    | "confidenceScore"
    | "estimatedCopiedRoi"
    | "rankingScore"
    | "winRate"
    | "roi"
    | "trades"
    | "recentFormScore"
    | "bestCategory"
    | "lowConfidence"
  >,
  snap: TraderMetricsSnapshot | null,
): TraderTruthMetrics {
  const tradeCount = snap?.tradeCount ?? trader.trades;
  const realizedRoi = snap?.roi ?? trader.roi;
  const totalPnl = snap?.estimatedTotalPnl ?? 0;
  const unrealized = snap?.unrealizedPnl ?? 0;
  const unrealizedRoi =
    totalPnl > 0 && Math.abs(unrealized) > 0
      ? unrealized / Math.max(1, totalPnl - unrealized)
      : 0;

  const roi30d = snap?.roi30d ?? realizedRoi;
  const roi7d = snap?.roi7d ?? roi30d;
  const roi90d = snap?.roi90d ?? realizedRoi;
  const maxDrawdown = snap?.maxDrawdown ?? 0.2;
  const consistencyScore = snap?.consistencyScore ?? trader.recentFormScore;
  const volatility = volatilityFromRoi(roi7d, roi30d, roi90d);
  const copyability = snap?.copyabilityScore ?? trader.copyabilityScore;
  const confidence = snap?.confidenceScore ?? trader.confidenceScore;
  const copiedRoi = snap?.estimatedCopiedRoi ?? trader.estimatedCopiedRoi;

  const traderExpectedValue =
    Math.round(copiedRoi * copyability * confidence * 1000) / 1000;

  let traderRiskScore = 0;
  traderRiskScore += Math.min(40, maxDrawdown * 100);
  traderRiskScore += Math.min(25, volatility * 80);
  if (tradeCount < 15) traderRiskScore += 20;
  else if (tradeCount < 30) traderRiskScore += 10;
  const lowConf = snap?.lowConfidence ?? trader.lowConfidence;
  if (lowConf) traderRiskScore += 12;
  traderRiskScore = Math.min(100, Math.round(traderRiskScore));

  const traderCopyScore = Math.round(
    Math.min(
      100,
      (snap?.rankingScore ?? trader.rankingScore) * 0.45 +
        copyability * 100 * 0.3 +
        clamp01(copiedRoi + 0.1) * 100 * 0.15 +
        confidence * 100 * 0.1,
    ) * 10,
  ) / 10;

  return {
    address: trader.address,
    traderId: trader.id,
    tier: trader.tier,
    realizedRoi,
    unrealizedRoi,
    winRate: snap?.winRate ?? trader.winRate,
    averageReturn: snap?.averageWin ?? realizedRoi * 0.5,
    medianReturn: (roi30d + roi90d) / 2,
    maxDrawdown,
    consistencyScore,
    volatility,
    specialization: snap?.specialistCategory ?? trader.bestCategory ?? null,
    categorySpecialization: snap?.bestCategory ?? trader.bestCategory ?? null,
    confidenceScore: confidence,
    copyabilityScore: copyability,
    tradeCount,
    volume30d: snap?.volume30d ?? 0,
    roi7d,
    roi30d,
    roi90d,
    formTrend: formTrend(roi7d, roi30d, trader.recentFormScore),
    traderExpectedValue,
    traderRiskScore,
    traderCopyScore,
  };
}
