import type { TraderTruthMetrics } from "./trader-truth.js";

export type CopyRecommendation = "COPY" | "WATCH" | "AVOID";

export interface CopyDecision {
  address: string;
  traderId: string;
  recommendation: CopyRecommendation;
  copyScore: number;
  riskScore: number;
  expectedValue: number;
  maxDrawdown: number;
  confidence: number;
  specialization: string | null;
  formTrend: TraderTruthMetrics["formTrend"];
  strengths: string[];
  weaknesses: string[];
  suggestedAllocationPct: number;
  suggestedUsdAt10k: number;
  suggestedUsdAt1k: number;
  suggestedUsdAt100: number;
}

function copyThresholds() {
  return {
    copyMin: Number(process.env.COPY_MIN_SCORE ?? "72"),
    copyMaxRisk: Number(process.env.COPY_MAX_RISK ?? "45"),
    watchMin: Number(process.env.COPY_WATCH_MIN_SCORE ?? "55"),
  };
}

export function decideCopyTrader(truth: TraderTruthMetrics): CopyDecision {
  const { copyMin: COPY_MIN_SCORE, copyMaxRisk: COPY_MAX_RISK, watchMin: WATCH_MIN_SCORE } =
    copyThresholds();
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (truth.copyabilityScore >= 0.35) {
    strengths.push("high copyability");
  }
  if (truth.traderExpectedValue > 0.08) {
    strengths.push("positive expected copy value");
  }
  if (truth.consistencyScore >= 0.5) {
    strengths.push("consistent returns");
  }
  if (truth.formTrend === "improving") {
    strengths.push("recent form improving");
  }
  if (truth.specialization) {
    strengths.push(`specialist in ${truth.specialization}`);
  }

  if (truth.tradeCount < 20) {
    weaknesses.push("limited trade history");
  }
  if (truth.confidenceScore < 0.45) {
    weaknesses.push("low confidence sample");
  }
  if (truth.maxDrawdown > 0.25) {
    weaknesses.push("elevated drawdown");
  }
  if (truth.formTrend === "deteriorating") {
    weaknesses.push("deteriorating recent form");
  }
  if (truth.copyabilityScore < 0.2) {
    weaknesses.push("low copyability");
  }

  let recommendation: CopyRecommendation = "AVOID";
  if (
    truth.traderCopyScore >= COPY_MIN_SCORE &&
    truth.traderRiskScore <= COPY_MAX_RISK &&
    truth.formTrend !== "deteriorating" &&
    truth.tradeCount >= 15 &&
    truth.copyabilityScore >= 0.22
  ) {
    recommendation = "COPY";
  } else if (
    truth.traderCopyScore >= WATCH_MIN_SCORE &&
    truth.traderRiskScore <= 65
  ) {
    recommendation = "WATCH";
  }

  if (truth.formTrend === "deteriorating" && truth.traderRiskScore > 50) {
    recommendation = "AVOID";
    weaknesses.push("auto-avoid: deteriorating + elevated risk");
  }

  const basePct =
    recommendation === "COPY"
      ? Math.min(0.05, 0.02 + truth.traderCopyScore / 2000)
      : recommendation === "WATCH"
        ? Math.min(0.02, 0.005 + truth.traderCopyScore / 5000)
        : 0;

  const scale = (bankroll: number) =>
    Math.round(bankroll * basePct * 100) / 100;

  return {
    address: truth.address,
    traderId: truth.traderId,
    recommendation,
    copyScore: truth.traderCopyScore,
    riskScore: truth.traderRiskScore,
    expectedValue: truth.traderExpectedValue,
    maxDrawdown: truth.maxDrawdown,
    confidence: truth.confidenceScore,
    specialization: truth.specialization,
    formTrend: truth.formTrend,
    strengths,
    weaknesses,
    suggestedAllocationPct: basePct,
    suggestedUsdAt10k: scale(10_000),
    suggestedUsdAt1k: scale(1_000),
    suggestedUsdAt100: scale(100),
  };
}

export function rankCopyDecisions(decisions: CopyDecision[]): CopyDecision[] {
  return [...decisions].sort((a, b) => {
    const order = { COPY: 0, WATCH: 1, AVOID: 2 };
    const d = order[a.recommendation] - order[b.recommendation];
    if (d !== 0) return d;
    return b.copyScore - a.copyScore;
  });
}
