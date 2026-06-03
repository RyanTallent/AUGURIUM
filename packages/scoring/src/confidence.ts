import { clamp } from "./math.js";

export interface ConfidenceInput {
  tradeCount: number;
  activeDays: number;
  marketCount: number;
  consistencyScore: number;
  lastSeen: Date | null;
  now: Date;
}

export function computeConfidenceScore(input: ConfidenceInput): number {
  const { tradeCount, activeDays, marketCount, consistencyScore, lastSeen, now } = input;

  const sampleFactor = clamp(tradeCount / 500, 0, 1);
  const daysFactor = clamp(activeDays / 60, 0, 1);
  const diversityFactor = clamp(marketCount / 25, 0, 1);
  const recencyFactor =
    lastSeen == null
      ? 0
      : clamp(1 - (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24 * 30), 0, 1);

  let score =
    sampleFactor * 0.35 +
    daysFactor * 0.2 +
    diversityFactor * 0.15 +
    consistencyScore * 0.15 +
    recencyFactor * 0.15;

  if (tradeCount < 30) score = Math.min(score, 0.55);
  if (tradeCount < 10) score = Math.min(score, 0.35);

  return clamp(score, 0, 1);
}
