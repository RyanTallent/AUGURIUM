import { clamp, safeDivide } from "./math.js";
import type { MarketQualityInput } from "./types.js";

export function computeMarketQualityScore(input: MarketQualityInput, now: Date): number {
  const { recentTrades, volume7d, tradeCount7d, tradeCount24h, uniqueTraders7d } = input;

  const volumeScore = clamp(Math.log10(volume7d + 1) * 25, 0, 100);
  const liquidityScore = clamp(tradeCount24h * 8 + uniqueTraders7d * 3, 0, 100);
  const activityScore = clamp(tradeCount7d * 2, 0, 100);

  let priceMovementScore = 0;
  if (recentTrades.length >= 2) {
    const prices = recentTrades.map((t) => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance =
      prices.reduce((s, p) => s + (p - mean) ** 2, 0) / Math.max(prices.length - 1, 1);
    priceMovementScore = clamp(Math.sqrt(variance) * 200, 0, 100);
  }

  let spreadRisk = 50;
  if (recentTrades.length >= 3) {
    const sorted = [...recentTrades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    const slips: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].price;
      if (prev > 0) slips.push(Math.abs(sorted[i].price - prev) / prev);
    }
    const avgSlip = slips.reduce((a, b) => a + b, 0) / slips.length;
    spreadRisk = clamp(100 - avgSlip * 500, 0, 100);
  }

  let stalePenalty = 0;
  const lastTrade = recentTrades.reduce(
    (max, t) => (t.tradedAt > max ? t.tradedAt : max),
    new Date(0),
  );
  if (recentTrades.length > 0) {
    const hoursSince = (now.getTime() - lastTrade.getTime()) / (3600 * 1000);
    if (hoursSince > 48) stalePenalty = 40;
    else if (hoursSince > 24) stalePenalty = 20;
  } else {
    stalePenalty = 50;
  }

  let resolutionPenalty = 0;
  if (input.closed || input.resolved) resolutionPenalty = 80;
  else if (input.endDate) {
    const daysToEnd = (input.endDate.getTime() - now.getTime()) / (86400 * 1000);
    if (daysToEnd < 0) resolutionPenalty = 60;
    else if (daysToEnd < 1) resolutionPenalty = 25;
  }

  const statusBonus = input.active && !input.closed ? 10 : 0;
  const ordersBonus = input.acceptingOrders ? 5 : 0;

  const raw =
    volumeScore * 0.25 +
    liquidityScore * 0.2 +
    spreadRisk * 0.15 +
    activityScore * 0.15 +
    priceMovementScore * 0.1 +
    statusBonus +
    ordersBonus;

  return clamp(raw - stalePenalty - resolutionPenalty, 0, 100);
}

export function isMarketQualityAcceptable(score: number): boolean {
  return score >= 55;
}
