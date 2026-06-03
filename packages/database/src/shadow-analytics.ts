import { prisma } from "./client.js";
import {
  closedPositionRoi,
  isCorruptRoi,
  summarizeRoiAnomalies,
  type RoiAnomalyKey,
} from "@augurium/shadow";
import { computeShadowRoiForensics } from "./shadow-roi-forensics.js";
import { computeZeroRoiBreakdown, type ZeroRoiBreakdown } from "./shadow-zero-roi.js";

export interface ShadowAnalyticsReport {
  sampleSize: number;
  openCount: number;
  closedCount: number;
  expiredCount: number;
  /** Win/loss/breakeven from authoritative ROI (realizedPnl / notional). */
  winRate: number;
  lossRate: number;
  breakevenRate: number;
  /** Mean of authoritative ROI excluding corrupt outliers (|ROI|>100%). */
  averageRoi: number;
  /** Raw mean including all trades — diagnostic only. */
  averageRoiRaw: number;
  medianRoi: number;
  profitFactor: number;
  averageHoldHours: number;
  maxDrawdown: number;
  sharpeLike: number;
  bestCategory: { category: string; avgRoi: number; count: number } | null;
  worstCategory: { category: string; avgRoi: number; count: number } | null;
  zeroRoiClosedPct: number;
  zeroMfePct: number;
  corruptRoiCount: number;
  analyticsTrustworthy: boolean;
  anomalyCounts: Record<RoiAnomalyKey, number>;
  zeroRoiBreakdown: ZeroRoiBreakdown;
  forensicsDiagnosis: string;
  bySignalType: Record<string, { count: number; avgRoi: number; winRate: number }>;
  generatedAt: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export async function computeShadowAnalytics(): Promise<ShadowAnalyticsReport> {
  const [openCount, closedCount, expiredCount, trades, forensics, zeroRoiBreakdown] =
    await Promise.all([
      prisma.shadowTrade.count({ where: { status: "OPEN" } }),
      prisma.shadowTrade.count({ where: { status: "CLOSED" } }),
      prisma.shadowTrade.count({ where: { status: "EXPIRED" } }),
      prisma.shadowTrade.findMany({
        where: { status: { in: ["CLOSED", "EXPIRED"] } },
        select: {
          roi: true,
          realizedPnl: true,
          unrealizedPnl: true,
          simulatedSizeUsd: true,
          maxFavorableExcursion: true,
          createdAt: true,
          closedAt: true,
          signalType: true,
          signal: { select: { category: true } },
        },
      }),
      computeShadowRoiForensics(),
      computeZeroRoiBreakdown(),
    ]);

  const authoritativeRois = trades.map((t) =>
    closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd),
  );
  const trustworthyRois = authoritativeRois.filter((r) => !isCorruptRoi(r));
  const corruptRoiCount = authoritativeRois.filter((r) => isCorruptRoi(r)).length;

  const wins = authoritativeRois.filter((r) => r > 0.001).length;
  const losses = authoritativeRois.filter((r) => r < -0.001).length;
  const breakeven = authoritativeRois.length - wins - losses;

  const grossWin = trades
    .filter((t) => t.realizedPnl > 0 && !isCorruptRoi(closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd)))
    .reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(
    trades
      .filter((t) => t.realizedPnl < 0 && !isCorruptRoi(closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd)))
      .reduce((s, t) => s + t.realizedPnl, 0),
  );

  const holdHours = trades
    .filter((t) => t.closedAt)
    .map((t) => (t.closedAt!.getTime() - t.createdAt.getTime()) / 3_600_000);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    if (isCorruptRoi(closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd))) continue;
    equity += t.realizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const avgRaw = authoritativeRois.length
    ? authoritativeRois.reduce((a, b) => a + b, 0) / authoritativeRois.length
    : 0;
  const avgTrust = trustworthyRois.length
    ? trustworthyRois.reduce((a, b) => a + b, 0) / trustworthyRois.length
    : 0;
  const roiStd = stdDev(trustworthyRois);
  const sharpeLike = roiStd > 0 ? avgTrust / roiStd : 0;

  const anomalySummary = summarizeRoiAnomalies(authoritativeRois);

  const byCategory = new Map<string, { sum: number; count: number }>();
  trades.forEach((t, i) => {
    const roi = authoritativeRois[i]!;
    if (isCorruptRoi(roi)) return;
    const cat = t.signal?.category ?? "Unknown";
    const row = byCategory.get(cat) ?? { sum: 0, count: 0 };
    row.sum += roi;
    row.count++;
    byCategory.set(cat, row);
  });
  const categoryRows = [...byCategory.entries()].map(([category, v]) => ({
    category,
    avgRoi: v.sum / v.count,
    count: v.count,
  }));
  categoryRows.sort((a, b) => b.avgRoi - a.avgRoi);

  const bySignalType: ShadowAnalyticsReport["bySignalType"] = {};
  for (const type of ["TRADE_NOW", "WATCHLIST", "RESEARCH"]) {
    const indices = trades
      .map((t, i) => ({ t, roi: authoritativeRois[i]! }))
      .filter((x) => x.t.signalType === type && !isCorruptRoi(x.roi));
    if (indices.length === 0) continue;
    bySignalType[type] = {
      count: indices.length,
      avgRoi: indices.reduce((s, x) => s + x.roi, 0) / indices.length,
      winRate: indices.filter((x) => x.roi > 0.001).length / indices.length,
    };
  }

  const zeroRoiClosed = zeroRoiBreakdown.pctOfClosed;
  const zeroMfe =
    trades.filter((t) => Math.abs(t.maxFavorableExcursion) < 0.0001).length /
    Math.max(1, trades.length);

  const med = median(trustworthyRois.length ? trustworthyRois : authoritativeRois);

  const analyticsTrustworthy =
    corruptRoiCount <= Math.max(2, Math.floor(trades.length * 0.01)) &&
    zeroRoiClosed < 0.55 &&
    Math.abs(avgRaw - avgTrust) < 0.15;

  return {
    sampleSize: trades.length,
    openCount,
    closedCount,
    expiredCount,
    winRate: authoritativeRois.length ? wins / authoritativeRois.length : 0,
    lossRate: authoritativeRois.length ? losses / authoritativeRois.length : 0,
    breakevenRate: authoritativeRois.length ? breakeven / authoritativeRois.length : 0,
    averageRoi: avgTrust,
    averageRoiRaw: avgRaw,
    medianRoi: med,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 10 : 0,
    averageHoldHours: holdHours.length
      ? holdHours.reduce((a, b) => a + b, 0) / holdHours.length
      : 0,
    maxDrawdown,
    sharpeLike,
    bestCategory: categoryRows[0] ?? null,
    worstCategory: categoryRows[categoryRows.length - 1] ?? null,
    zeroRoiClosedPct: zeroRoiClosed,
    zeroMfePct: zeroMfe,
    corruptRoiCount,
    analyticsTrustworthy,
    anomalyCounts: anomalySummary.counts,
    zeroRoiBreakdown,
    forensicsDiagnosis: forensics.diagnosis,
    bySignalType,
    generatedAt: new Date().toISOString(),
  };
}
