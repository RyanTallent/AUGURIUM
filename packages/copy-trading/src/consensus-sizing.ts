import { getLiveCopySizingConfig, type LiveCopySizingConfig } from "./copy-live-sizing.js";

/** Consensus fraction of bankroll by distinct leader count on same market. */
export function consensusLeaderCountPct(leaderCount: number): number {
  const n = Math.max(0, Math.floor(leaderCount));
  if (n <= 0) return 0;
  if (n === 1) return 0.15;
  if (n === 2) return 0.25;
  if (n === 3) return 0.35;
  return 0.5;
}

/**
 * Soft diversification — reduce size when leaders are highly correlated (same category/trader cluster).
 * correlation: 0 = uncorrelated, 1 = fully correlated.
 */
export function applySoftDiversification(basePct: number, correlation: number): number {
  if (basePct <= 0) return 0;
  const c = Math.max(0, Math.min(1, correlation));
  const factor = 1 - c * 0.35;
  return Math.max(0.05, basePct * factor);
}

export function estimateLeaderCorrelation(input: {
  sameCategory: boolean;
  sameTraderCluster: boolean;
}): number {
  let c = 0.15;
  if (input.sameCategory) c += 0.35;
  if (input.sameTraderCluster) c += 0.25;
  return Math.min(1, c);
}

/** Consensus-based live trade size in USD. */
export function computeConsensusTradeSizeUsd(
  bankrollUsd: number,
  deployedUsd: number,
  leaderCount: number,
  opts?: {
    config?: LiveCopySizingConfig;
    availableUsd?: number;
    correlation?: number;
    sameCategory?: boolean;
  },
): number {
  if (bankrollUsd <= 0 || leaderCount <= 0) return 0;

  const config = opts?.config ?? getLiveCopySizingConfig();
  let pct = consensusLeaderCountPct(leaderCount);
  const correlation =
    opts?.correlation ??
    estimateLeaderCorrelation({
      sameCategory: opts?.sameCategory ?? false,
      sameTraderCluster: false,
    });
  pct = applySoftDiversification(pct, correlation);
  pct = Math.min(pct, config.maxTradePct);

  const maxDeployUsd = bankrollUsd * config.maxDeployedPct;
  const deployRoom = Math.max(0, maxDeployUsd - deployedUsd);
  let sizeUsd = Math.min(bankrollUsd * pct, deployRoom);

  if (opts?.availableUsd != null && opts.availableUsd > 0) {
    sizeUsd = Math.min(sizeUsd, opts.availableUsd);
  }

  const rounded = Math.round(sizeUsd * 100) / 100;
  if (rounded < config.minTradeUsd) return 0;
  return rounded;
}
