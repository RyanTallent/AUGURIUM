import { clamp } from "./math.js";
import type { SideConsensusResult } from "./types.js";

export interface AlphaInput {
  consensus: SideConsensusResult;
  marketQualityScore: number;
  disagreementScore: number;
  capitalEfficiency: number;
  movementConfirmation: number;
}

export function computeAlphaScore(input: AlphaInput): number {
  const { consensus, marketQualityScore, disagreementScore } = input;

  const participation =
    consensus.copyabilityScore * 0.6 + clamp(consensus.tradeCount / 10, 0, 1) * 0.4;

  const disagreementPenalty = disagreementScore * 25;

  const raw =
    consensus.consensusScore * 0.35 +
    marketQualityScore * 0.25 +
    participation * 100 * 0.15 +
    consensus.informationEdgeScore * 100 * 0.1 +
    input.capitalEfficiency * 100 * 0.08 +
    input.movementConfirmation * 100 * 0.07 -
    disagreementPenalty;

  return clamp(raw, 0, 100);
}

export function computeCapitalEfficiency(medianCopiedRoi: number, conviction: number): number {
  return clamp(medianCopiedRoi * 2 + conviction * 0.3, 0, 1);
}

export function computeMovementConfirmation(recentPriceDrift: number): number {
  return clamp(recentPriceDrift * 5, 0, 1);
}
