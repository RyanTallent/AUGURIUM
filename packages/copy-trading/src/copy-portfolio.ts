import type { CopyDecision } from "./copy-decision.js";
import type { TraderTruthMetrics } from "./trader-truth.js";

export type CopyPortfolioStrategyId =
  | "top_1"
  | "top_5"
  | "top_10"
  | "risk_adjusted"
  | "specialists"
  | "diversified";

export interface CopyPortfolioStrategyResult {
  id: CopyPortfolioStrategyId;
  label: string;
  traderCount: number;
  traders: Array<{ address: string; weight: number }>;
  roi30d: number;
  maxDrawdown: number;
  volatility: number;
  sharpeLike: number;
  hitRate: number;
  expectedValue: number;
  capitalAllocationPct: number;
}

function weighted(
  truths: Array<{ truth: TraderTruthMetrics; weight: number }>,
): Omit<CopyPortfolioStrategyResult, "id" | "label" | "traderCount" | "traders" | "capitalAllocationPct"> {
  if (truths.length === 0) {
    return {
      roi30d: 0,
      maxDrawdown: 0,
      volatility: 0,
      sharpeLike: 0,
      hitRate: 0,
      expectedValue: 0,
    };
  }
  const wSum = truths.reduce((s, t) => s + t.weight, 0) || 1;
  let roi30d = 0;
  let maxDrawdown = 0;
  let volatility = 0;
  let hitRate = 0;
  let expectedValue = 0;
  for (const { truth, weight } of truths) {
    const w = weight / wSum;
    roi30d += truth.roi30d * w;
    maxDrawdown = Math.max(maxDrawdown, truth.maxDrawdown);
    volatility += truth.volatility * w;
    hitRate += truth.winRate * w;
    expectedValue += truth.traderExpectedValue * w;
  }
  const sharpeLike = volatility > 0.01 ? roi30d / volatility : roi30d > 0 ? 1 : 0;
  return {
    roi30d: Math.round(roi30d * 10000) / 10000,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    volatility: Math.round(volatility * 10000) / 10000,
    sharpeLike: Math.round(sharpeLike * 100) / 100,
    hitRate: Math.round(hitRate * 10000) / 10000,
    expectedValue: Math.round(expectedValue * 10000) / 10000,
  };
}

function pickTop(
  decisions: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }>,
  n: number,
  filter: (d: CopyDecision) => boolean = () => true,
): Array<{ decision: CopyDecision; truth: TraderTruthMetrics }> {
  return decisions
    .filter((x) => filter(x.decision))
    .sort((a, b) => b.decision.copyScore - a.decision.copyScore)
    .slice(0, n);
}

export function simulateCopyPortfolios(
  ranked: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }>,
): CopyPortfolioStrategyResult[] {
  const copyOnly = ranked.filter((r) => r.decision.recommendation === "COPY");
  const watchPlus = ranked.filter((r) =>
    ["COPY", "WATCH"].includes(r.decision.recommendation),
  );

  const strategies: Array<{
    id: CopyPortfolioStrategyId;
    label: string;
    picks: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }>;
    allocPct: number;
  }> = [
    {
      id: "top_1",
      label: "Top 1 trader",
      picks: pickTop(copyOnly.length ? copyOnly : watchPlus, 1),
      allocPct: 0.05,
    },
    {
      id: "top_5",
      label: "Top 5 traders (equal weight)",
      picks: pickTop(copyOnly.length ? copyOnly : watchPlus, 5),
      allocPct: Math.min(0.25, 0.05 * 5),
    },
    {
      id: "top_10",
      label: "Top 10 traders (equal weight)",
      picks: pickTop(copyOnly.length ? copyOnly : watchPlus, 10),
      allocPct: Math.min(0.5, 0.05 * 10),
    },
    {
      id: "risk_adjusted",
      label: "Risk-adjusted top traders",
      picks: [...(copyOnly.length ? copyOnly : watchPlus)]
        .sort(
          (a, b) =>
            b.decision.copyScore / Math.max(1, b.decision.riskScore) -
            a.decision.copyScore / Math.max(1, a.decision.riskScore),
        )
        .slice(0, 5),
      allocPct: 0.2,
    },
    {
      id: "specialists",
      label: "Category specialists",
      picks: [...ranked]
        .filter((r) => r.truth.specialization)
        .sort((a, b) => b.decision.copyScore - a.decision.copyScore)
        .slice(0, 5),
      allocPct: 0.15,
    },
    {
      id: "diversified",
      label: "Diversified copy basket",
      picks: diversifiedBasket(copyOnly.length ? copyOnly : watchPlus, 6),
      allocPct: 0.24,
    },
  ];

  return strategies.map((s) => {
    const n = s.picks.length || 1;
    const weight = 1 / n;
    const metrics = weighted(
      s.picks.map((p) => ({ truth: p.truth, weight })),
    );
    return {
      id: s.id,
      label: s.label,
      traderCount: s.picks.length,
      traders: s.picks.map((p) => ({
        address: p.decision.address,
        weight,
      })),
      capitalAllocationPct: s.allocPct,
      ...metrics,
    };
  });
}

function diversifiedBasket(
  ranked: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }>,
  max: number,
): Array<{ decision: CopyDecision; truth: TraderTruthMetrics }> {
  const out: typeof ranked = [];
  const cats = new Set<string>();
  for (const r of ranked) {
    const cat = r.truth.specialization ?? r.truth.categorySpecialization ?? "other";
    const count = [...cats].filter((c) => c === cat).length;
    if (count >= 2) continue;
    out.push(r);
    cats.add(cat);
    if (out.length >= max) break;
  }
  if (out.length < max) {
    for (const r of ranked) {
      if (out.includes(r)) continue;
      out.push(r);
      if (out.length >= max) break;
    }
  }
  return out;
}
