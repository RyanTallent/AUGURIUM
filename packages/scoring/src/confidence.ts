import { clamp } from "./math.js";

export interface ConfidenceInput {
  tradeCount: number;
  activeDays: number;
  marketCount: number;
  totalVolume: number;
  consistencyScore: number;
  lastSeen: Date | null;
  now: Date;
}

export interface ConfidenceResult {
  score: number;
  reason: string;
}

export function computeConfidenceScore(input: ConfidenceInput): ConfidenceResult {
  const {
    tradeCount,
    activeDays,
    marketCount,
    totalVolume,
    consistencyScore,
    lastSeen,
    now,
  } = input;

  if (tradeCount < 5) {
    return { score: 0, reason: "Not scored: fewer than 5 trades" };
  }

  const sampleFactor = clamp(tradeCount / 500, 0, 1);
  const daysFactor = clamp(activeDays / 60, 0, 1);
  const diversityFactor = clamp(marketCount / 25, 0, 1);
  const volumeFactor = clamp(totalVolume / 5000, 0, 1);
  const recencyFactor =
    lastSeen == null
      ? 0
      : clamp(1 - (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24 * 30), 0, 1);

  let score =
    sampleFactor * 0.3 +
    daysFactor * 0.15 +
    diversityFactor * 0.15 +
    volumeFactor * 0.15 +
    consistencyScore * 0.1 +
    recencyFactor * 0.15;

  const penalties: string[] = [];

  if (tradeCount < 25) {
    score = Math.min(score, 0.25);
    penalties.push(`trade cap (${tradeCount}<25)`);
  } else if (tradeCount < 100) {
    score = Math.min(score, 0.55);
    penalties.push(`trade cap (${tradeCount}<100)`);
  }

  if (totalVolume < 500) {
    score = Math.min(score, 0.2);
    penalties.push("volume<$500");
  }
  if (activeDays < 7) {
    score = Math.min(score, 0.25);
    penalties.push("activeDays<7");
  }
  if (marketCount < 3) {
    score = Math.min(score, 0.3);
    penalties.push("markets<3");
  }

  const topMarketShare =
    marketCount > 0 ? clamp(1 / marketCount, 0, 1) : 1;
  if (marketCount === 1) {
    score = Math.min(score, 0.35);
    penalties.push("single-market concentration");
  } else if (topMarketShare > 0.5 && tradeCount < 50) {
    score = Math.min(score, 0.45);
    penalties.push("concentrated activity");
  }

  const finalScore = clamp(score, 0, 1);
  const reason =
    penalties.length > 0
      ? `Confidence ${(finalScore * 100).toFixed(0)}% capped: ${penalties.join(", ")}`
      : `Confidence ${(finalScore * 100).toFixed(0)}% from ${tradeCount} trades, ${activeDays}d active, $${totalVolume.toFixed(0)} volume`;

  return { score: finalScore, reason };
}
