import type { CategoryMetricResult, RealizedRoundTrip, TradeInput } from "./types.js";
import { safeDivide } from "./math.js";
import { winRateFromTrips } from "./round-trips.js";

export function computeCategoryMetrics(
  trades: TradeInput[],
  trips: RealizedRoundTrip[],
): CategoryMetricResult[] {
  const categories = new Map<string, { trades: TradeInput[]; trips: RealizedRoundTrip[] }>();

  for (const t of trades) {
    const cat = t.category ?? "uncategorized";
    const bucket = categories.get(cat) ?? { trades: [], trips: [] };
    bucket.trades.push(t);
    categories.set(cat, bucket);
  }

  for (const trip of trips) {
    const cat = trip.category ?? "uncategorized";
    const bucket = categories.get(cat) ?? { trades: [], trips: [] };
    bucket.trips.push(trip);
    categories.set(cat, bucket);
  }

  const results: CategoryMetricResult[] = [];

  for (const [category, data] of categories) {
    const volume = data.trades.reduce((s, t) => s + t.size * t.price, 0);
    const pnl = data.trips.reduce((s, t) => s + t.pnl, 0);
    const notional = data.trips.reduce((s, t) => s + t.notional, 0) || volume;
    const roi = safeDivide(pnl, notional, 0);
    const winRate = winRateFromTrips(data.trips);
    const tradeShare = safeDivide(data.trades.length, trades.length, 0);
    const roiShare = Math.abs(roi);
    const specialistScore = clamp01(tradeShare * 0.5 + roiShare * 0.5);

    results.push({
      category,
      tradeCount: data.trades.length,
      volume,
      roi,
      winRate,
      specialistScore,
    });
  }

  return results.sort((a, b) => b.specialistScore - a.specialistScore);
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function pickBestCategory(metrics: CategoryMetricResult[]): string | null {
  if (!metrics.length) return null;
  return metrics.reduce((a, b) => (b.roi > a.roi ? b : a)).category;
}

export function pickSpecialistCategory(metrics: CategoryMetricResult[]): {
  category: string | null;
  score: number;
} {
  if (!metrics.length) return { category: null, score: 0 };
  const top = metrics[0];
  return { category: top.category, score: top.specialistScore };
}
