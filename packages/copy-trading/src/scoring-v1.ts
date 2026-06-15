import type { TraderTruthMetrics } from "./trader-truth.js";

export interface ScoringV1Input {
  truth: TraderTruthMetrics;
  /** 0–1 US catalog match confidence for this leader/position context */
  usMatchConfidence?: number;
  /** Recent drawdown as fraction (0–1); defaults to truth.maxDrawdown */
  recentDrawdown?: number;
  activeDays?: number;
  specialistScore?: number;
  recentFormScore?: number;
  /** When true, US match is enforced separately — do not double-penalize confidence. */
  usMatchHardGated?: boolean;
}

export interface ScoringV1Result {
  lifetime: number;
  heat: number;
  confidence: number;
  uncertainty: number;
  conviction: number;
  usMatchPct: number;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/** Map ROI fraction to 0–100 (30% ROI ≈ 100). */
function roiScore(roi: number): number {
  return clamp100((roi + 0.05) * (100 / 0.35));
}

function tradeCountScore(count: number): number {
  if (count >= 100) return 100;
  if (count >= 50) return 70 + ((count - 50) / 50) * 30;
  return clamp100((count / 100) * 60);
}

function drawdownSafetyScore(drawdown: number): number {
  return clamp100(100 - drawdown * (100 / 0.15));
}

function sampleSizeUncertainty(tradeCount: number): number {
  if (tradeCount >= 150) return 10;
  if (tradeCount >= 100) return 20;
  if (tradeCount >= 50) return 40;
  if (tradeCount >= 25) return 60;
  return 80;
}

function tierConvictionBonus(tier: string): number {
  if (tier === "SUPER_ELITE") return 6;
  if (tier === "ELITE") return 4;
  if (tier === "RISING") return 2;
  return 0;
}

/** v1 pillar scores (0–100 each). */
export function computeScoringV1(input: ScoringV1Input): ScoringV1Result {
  const { truth } = input;
  const recentDd = input.recentDrawdown ?? truth.maxDrawdown;
  const specialist = input.specialistScore ?? truth.copyabilityScore;
  const recentForm = input.recentFormScore ?? truth.consistencyScore;
  const usMatch = input.usMatchConfidence ?? 0;
  const activeDays = input.activeDays ?? Math.min(365, truth.tradeCount / 2);

  const lifetime = clamp100(
    roiScore(truth.realizedRoi) * 0.3 +
      truth.winRate * 100 * 0.2 +
      tradeCountScore(truth.tradeCount) * 0.15 +
      drawdownSafetyScore(truth.maxDrawdown) * 0.15 +
      truth.consistencyScore * 100 * 0.1 +
      clamp100(specialist * 100) * 0.1,
  );

  const heat = clamp100(
    recentForm * 100 * 0.3 +
      roiScore(truth.roi7d) * 0.25 +
      roiScore(truth.roi30d) * 0.2 +
      truth.winRate * 100 * 0.15 +
      drawdownSafetyScore(recentDd) * 0.1,
  );

  const durability = clamp100(Math.min(100, activeDays * 0.5 + tradeCountScore(truth.tradeCount) * 0.3));
  const categorySpecialty = clamp100(specialist * 100);
  const usMatchPct = clamp100(usMatch * 100);

  const uncertaintyPenalty =
    input.usMatchHardGated || usMatch >= 0.9 ? 0 : clamp100((0.9 - usMatch) * 120);

  const confidence = clamp100(
    lifetime * 0.35 +
      heat * 0.25 +
      categorySpecialty * 0.15 +
      durability * 0.15 +
      usMatchPct * 0.1 -
      uncertaintyPenalty * 0.5,
  );

  const uncertainty = clamp100(
    sampleSizeUncertainty(truth.tradeCount) * 0.25 +
      clamp100(truth.volatility * 100) * 0.2 +
      clamp100((1 - truth.copyabilityScore) * 100) * 0.2 +
      (truth.specialization ? 15 : 45) * 0.15 +
      clamp100(truth.volatility * 80) * 0.1 +
      (truth.confidenceScore < 0.35 ? 55 : 25) * 0.1,
  );

  const specialtyBonus = truth.specialization ? 3 : 0;
  const conviction = clamp100(
    confidence -
      uncertainty * 0.45 +
      tierConvictionBonus(truth.tier) +
      specialtyBonus,
  );

  return {
    lifetime,
    heat,
    confidence,
    uncertainty,
    conviction,
    usMatchPct,
  };
}

/** Trade size as fraction of bankroll from conviction tier. */
export function convictionTradePct(conviction: number): number {
  if (conviction >= 95) return 0.15;
  if (conviction >= 85) return 0.12;
  if (conviction >= 75) return 0.08;
  if (conviction >= 60) return 0.05;
  return 0;
}
