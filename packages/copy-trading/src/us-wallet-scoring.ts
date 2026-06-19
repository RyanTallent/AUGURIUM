import type { TraderTruthMetrics } from "./trader-truth.js";

export interface UsWalletScoreInput {
  truth: TraderTruthMetrics;
  recentDrawdown?: number;
  avgHoldTimeHours?: number;
  profitFactor?: number;
  winStreak?: number;
  lossStreak?: number;
  categorySpecialty?: string | null;
  specialtyScore?: number;
}

export interface UsWalletScore {
  lifetimeRoi: number;
  recentRoi: number;
  winRate: number;
  tradeCount: number;
  maxDrawdown: number;
  holdTimeHours: number;
  profitFactor: number;
  winStreak: number;
  lossStreak: number;
  consistency: number;
  categorySpecialty: string | null;
  specialtyScore: number;
  rankingScore: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** US-native wallet score from trader truth + optional trade-history metrics. */
export function computeUsWalletScore(input: UsWalletScoreInput): UsWalletScore {
  const { truth } = input;
  const recentRoi = truth.roi30d || truth.roi7d || 0;
  const recentDrawdown = input.recentDrawdown ?? truth.maxDrawdown;
  const profitFactor = input.profitFactor ?? Math.max(0.5, 1 + truth.realizedRoi);
  const specialtyScore = input.specialtyScore ?? truth.copyabilityScore;

  const consistency = clamp01(truth.consistencyScore);
  const lifetimeRoi = truth.realizedRoi;

  const rankingScore = Math.round(
    clamp01(lifetimeRoi + 0.15) * 30 +
      clamp01(recentRoi + 0.1) * 25 +
      truth.winRate * 20 +
      Math.min(1, truth.tradeCount / 150) * 15 +
      (1 - clamp01(recentDrawdown / 0.25)) * 10 +
      specialtyScore * 10,
  );

  return {
    lifetimeRoi,
    recentRoi,
    winRate: truth.winRate,
    tradeCount: truth.tradeCount,
    maxDrawdown: recentDrawdown,
    holdTimeHours: input.avgHoldTimeHours ?? 0,
    profitFactor,
    winStreak: input.winStreak ?? 0,
    lossStreak: input.lossStreak ?? 0,
    consistency,
    categorySpecialty: input.categorySpecialty ?? null,
    specialtyScore,
    rankingScore,
  };
}
