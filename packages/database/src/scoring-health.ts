/** Scoring coverage uses eligible wallets only (not all discovered wallets). */

export interface ScoringHealthMetrics {
  scoredWallets: number;
  unscoredEligibleRemaining: number;
  eligibleWallets: number;
  /** % of eligible wallets that have been scored at least once. */
  scoreCoverageEligiblePct: number;
  /** True when every eligible wallet has been scored (queue caught up). */
  scoringHealthy: boolean;
}

export function computeScoringHealth(
  scoredWallets: number,
  unscoredEligibleRemaining: number,
): ScoringHealthMetrics {
  const eligibleWallets = scoredWallets + unscoredEligibleRemaining;
  const scoreCoverageEligiblePct =
    eligibleWallets > 0
      ? Number(((scoredWallets / eligibleWallets) * 100).toFixed(1))
      : 100;
  const scoringHealthy = unscoredEligibleRemaining === 0;

  return {
    scoredWallets,
    unscoredEligibleRemaining,
    eligibleWallets,
    scoreCoverageEligiblePct,
    scoringHealthy,
  };
}

export function scoringWarningMessage(metrics: ScoringHealthMetrics): string | null {
  if (metrics.scoringHealthy) return null;
  return (
    `Scoring backlog: ${metrics.unscoredEligibleRemaining} eligible wallet(s) not scored yet ` +
    `(${metrics.scoreCoverageEligiblePct}% of ${metrics.eligibleWallets} eligible scored). ` +
    `Worker score-traders needs more runs.`
  );
}
