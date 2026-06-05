import type { CopyDecision } from "./copy-decision.js";
import type { TraderTruthMetrics } from "./trader-truth.js";

/**
 * Higher = better expected copy outcome per unit of risk (scan → rank → mirror).
 */
export function copyEfficiencyScore(
  truth: TraderTruthMetrics,
  decision: CopyDecision,
): number {
  if (decision.recommendation !== "COPY") return -1;

  let score =
    (decision.copyScore / 100) *
    (0.4 + truth.copyabilityScore) *
    (0.3 + Math.min(1, truth.traderExpectedValue + 0.2)) *
    (0.5 + truth.confidenceScore);

  score *= 100 / Math.max(5, decision.riskScore);

  if (truth.formTrend === "improving") score *= 1.1;
  if (truth.formTrend === "deteriorating") score *= 0.7;
  if (truth.tradeCount >= 40) score *= 1.05;

  const lagPenalty = Math.min(0.35, truth.avgCopyDelayMs / 180_000);
  score *= 1 - lagPenalty;
  score *= 0.5 + truth.mirrorabilityScore * 0.5;

  return Math.round(score * 1000) / 1000;
}

export function sortCopyTargetsByEfficiency(
  ranked: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }>,
): Array<{ decision: CopyDecision; truth: TraderTruthMetrics; efficiency: number }> {
  return ranked
    .filter((r) => r.decision.recommendation === "COPY")
    .map((r) => ({
      ...r,
      efficiency: copyEfficiencyScore(r.truth, r.decision),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);
}
