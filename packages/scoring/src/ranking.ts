import { clamp } from "./math.js";
import type { TraderTier } from "./types.js";

export interface RankingInput {
  estimatedCopiedRoi: number;
  copyabilityScore: number;
  informationEdgeScore: number;
  confidenceScore: number;
  consistencyScore: number;
  recentFormScore: number;
}

export function computeRankingScore(input: RankingInput): number {
  const copied = clamp((input.estimatedCopiedRoi + 0.2) * 200, 0, 100);
  const copyability = input.copyabilityScore * 100;
  const edge = input.informationEdgeScore * 100;
  const confidence = input.confidenceScore * 100;
  const consistency = input.consistencyScore * 100;
  const recent = input.recentFormScore * 100;

  const score =
    copied * 0.35 +
    copyability * 0.25 +
    edge * 0.15 +
    confidence * 0.1 +
    consistency * 0.1 +
    recent * 0.05;

  return clamp(score, 0, 100);
}

export interface TierInput {
  tradeCount: number;
  rankingScore: number;
  roi30d: number;
  copyabilityScore: number;
  informationEdgeScore: number;
  confidenceScore: number;
  lowConfidence: boolean;
}

export function classifyTier(input: TierInput): TraderTier {
  if (input.lowConfidence || input.tradeCount < 5) return "UNRANKED";

  const emerging =
    input.tradeCount < 80 &&
    input.roi30d > 0.05 &&
    input.copyabilityScore > 0.55 &&
    input.informationEdgeScore > 0.55;

  if (input.rankingScore >= 85 && input.tradeCount >= 150 && input.confidenceScore >= 0.65) {
    return "SUPER_ELITE";
  }
  if (input.rankingScore >= 72 && input.tradeCount >= 80) {
    return "ELITE";
  }
  if (emerging || (input.rankingScore >= 58 && input.tradeCount >= 20)) {
    return "RISING";
  }
  if (input.tradeCount >= 10) {
    return "PROSPECT";
  }
  return "UNRANKED";
}
