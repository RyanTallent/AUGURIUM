import { prisma } from "./client.js";

export interface ShadowAnalyticsReport {
  sampleSize: number;
  openCount: number;
  closedCount: number;
  expiredCount: number;
  winRate: number;
  lossRate: number;
  breakevenRate: number;
  averageRoi: number;
  medianRoi: number;
  profitFactor: number;
  averageHoldHours: number;
  maxDrawdown: number;
  sharpeLike: number;
  bestCategory: { category: string; avgRoi: number; count: number } | null;
  worstCategory: { category: string; avgRoi: number; count: number } | null;
  zeroRoiClosedPct: number;
  zeroMfePct: number;
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
  const [openCount, closedCount, expiredCount, trades] = await Promise.all([
    prisma.shadowTrade.count({ where: { status: "OPEN" } }),
    prisma.shadowTrade.count({ where: { status: "CLOSED" } }),
    prisma.shadowTrade.count({ where: { status: "EXPIRED" } }),
    prisma.shadowTrade.findMany({
      where: { status: { in: ["CLOSED", "EXPIRED"] } },
      select: {
        roi: true,
        realizedPnl: true,
        unrealizedPnl: true,
        maxFavorableExcursion: true,
        createdAt: true,
        closedAt: true,
        signalType: true,
        signal: { select: { category: true } },
      },
    }),
  ]);

  const rois = trades.map((t) => t.roi);
  const wins = rois.filter((r) => r > 0.001).length;
  const losses = rois.filter((r) => r < -0.001).length;
  const breakeven = rois.length - wins - losses;

  const grossWin = trades
    .filter((t) => t.realizedPnl + t.unrealizedPnl > 0)
    .reduce((s, t) => s + t.realizedPnl + t.unrealizedPnl, 0);
  const grossLoss = Math.abs(
    trades
      .filter((t) => t.realizedPnl + t.unrealizedPnl < 0)
      .reduce((s, t) => s + t.realizedPnl + t.unrealizedPnl, 0),
  );

  const holdHours = trades
    .filter((t) => t.closedAt)
    .map((t) => (t.closedAt!.getTime() - t.createdAt.getTime()) / 3_600_000);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += t.realizedPnl + t.unrealizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const avgRoi = rois.length ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;
  const roiStd = stdDev(rois);
  const sharpeLike = roiStd > 0 ? avgRoi / roiStd : 0;

  const byCategory = new Map<string, { sum: number; count: number }>();
  for (const t of trades) {
    const cat = t.signal?.category ?? "Unknown";
    const row = byCategory.get(cat) ?? { sum: 0, count: 0 };
    row.sum += t.roi;
    row.count++;
    byCategory.set(cat, row);
  }
  const categoryRows = [...byCategory.entries()].map(([category, v]) => ({
    category,
    avgRoi: v.sum / v.count,
    count: v.count,
  }));
  categoryRows.sort((a, b) => b.avgRoi - a.avgRoi);

  const bySignalType: ShadowAnalyticsReport["bySignalType"] = {};
  for (const type of ["TRADE_NOW", "WATCHLIST", "RESEARCH"]) {
    const subset = trades.filter((t) => t.signalType === type);
    if (subset.length === 0) continue;
    const subsetRois = subset.map((t) => t.roi);
    bySignalType[type] = {
      count: subset.length,
      avgRoi: subsetRois.reduce((a, b) => a + b, 0) / subset.length,
      winRate: subsetRois.filter((r) => r > 0.001).length / subset.length,
    };
  }

  const zeroRoiClosed =
    trades.filter((t) => Math.abs(t.roi) < 0.0001).length / Math.max(1, trades.length);
  const zeroMfe =
    trades.filter((t) => Math.abs(t.maxFavorableExcursion) < 0.0001).length /
    Math.max(1, trades.length);

  return {
    sampleSize: trades.length,
    openCount,
    closedCount,
    expiredCount,
    winRate: rois.length ? wins / rois.length : 0,
    lossRate: rois.length ? losses / rois.length : 0,
    breakevenRate: rois.length ? breakeven / rois.length : 0,
    averageRoi: avgRoi,
    medianRoi: median(rois),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
    averageHoldHours: holdHours.length
      ? holdHours.reduce((a, b) => a + b, 0) / holdHours.length
      : 0,
    maxDrawdown,
    sharpeLike,
    bestCategory: categoryRows[0] ?? null,
    worstCategory: categoryRows[categoryRows.length - 1] ?? null,
    zeroRoiClosedPct: zeroRoiClosed,
    zeroMfePct: zeroMfe,
    bySignalType,
    generatedAt: new Date().toISOString(),
  };
}
