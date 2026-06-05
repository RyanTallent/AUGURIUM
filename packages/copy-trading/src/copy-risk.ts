import type { CopyDecision } from "./copy-decision.js";
import type { TraderTruthMetrics } from "./trader-truth.js";

export const COPY_RISK_LIMITS = {
  maxCapitalPerTraderPct: 0.05,
  maxCapitalPerMarketPct: 0.2,
  maxCapitalPerCategoryPct: 0.2,
  maxCapitalPerEventPct: 0.3,
  maxTraderDrawdownPct: 0.2,
} as const;

export interface CopyExposureSnapshot {
  traderExposure: Array<{ traderId: string; address: string; pct: number; usd: number }>;
  categoryExposure: Array<{ category: string; pct: number; usd: number }>;
  marketExposure: Array<{ marketId: string; pct: number; usd: number }>;
  concentrationWarnings: string[];
}

export function evaluateTraderDrawdownDisable(
  truth: TraderTruthMetrics,
): { disabled: boolean; reason: string | null } {
  if (truth.maxDrawdown > COPY_RISK_LIMITS.maxTraderDrawdownPct) {
    return {
      disabled: true,
      reason: `drawdown ${(truth.maxDrawdown * 100).toFixed(0)}% exceeds ${COPY_RISK_LIMITS.maxTraderDrawdownPct * 100}% cap`,
    };
  }
  if (truth.formTrend === "deteriorating" && truth.roi7d < -0.08) {
    return {
      disabled: true,
      reason: "deteriorating trader with negative 7d ROI",
    };
  }
  return { disabled: false, reason: null };
}

export function capAllocationPct(
  requestedPct: number,
  limits = COPY_RISK_LIMITS,
): number {
  return Math.min(requestedPct, limits.maxCapitalPerTraderPct);
}

export function buildExposureSnapshot(
  bankroll: number,
  rows: Array<{
    traderId: string;
    address: string;
    marketId: string;
    category: string | null;
    usd: number;
  }>,
): CopyExposureSnapshot {
  const warnings: string[] = [];
  const byTrader = new Map<string, { address: string; usd: number }>();
  const byCat = new Map<string, number>();
  const byMarket = new Map<string, number>();

  for (const r of rows) {
    const t = byTrader.get(r.traderId) ?? { address: r.address, usd: 0 };
    t.usd += r.usd;
    byTrader.set(r.traderId, t);
    const cat = r.category ?? "uncategorized";
    byCat.set(cat, (byCat.get(cat) ?? 0) + r.usd);
    byMarket.set(r.marketId, (byMarket.get(r.marketId) ?? 0) + r.usd);
  }

  const traderExposure = [...byTrader.entries()].map(([traderId, v]) => {
    const pct = bankroll > 0 ? v.usd / bankroll : 0;
    if (pct > COPY_RISK_LIMITS.maxCapitalPerTraderPct) {
      warnings.push(`trader ${v.address.slice(0, 8)}… exceeds 5% cap`);
    }
    return { traderId, address: v.address, pct, usd: v.usd };
  });

  const categoryExposure = [...byCat.entries()].map(([category, usd]) => {
    const pct = bankroll > 0 ? usd / bankroll : 0;
    if (pct > COPY_RISK_LIMITS.maxCapitalPerCategoryPct) {
      warnings.push(`category ${category} exceeds 20% cap`);
    }
    return { category, pct, usd };
  });

  const marketExposure = [...byMarket.entries()].map(([marketId, usd]) => {
    const pct = bankroll > 0 ? usd / bankroll : 0;
    if (pct > COPY_RISK_LIMITS.maxCapitalPerMarketPct) {
      warnings.push(`market ${marketId} exceeds 20% cap`);
    }
    return { marketId, pct, usd };
  });

  return { traderExposure, categoryExposure, marketExposure, concentrationWarnings: warnings };
}

/** Downgrade COPY when recent form collapsed (copy decay). */
export function applyCopyDecay(
  decision: CopyDecision,
  truth: TraderTruthMetrics,
): CopyDecision {
  if (decision.recommendation !== "COPY") return decision;
  if (truth.roi7d < -0.12) {
    return {
      ...decision,
      recommendation: "AVOID",
      weaknesses: [...decision.weaknesses, "copy decay: 7d ROI below -12%"],
      suggestedAllocationPct: 0,
      suggestedUsdAt10k: 0,
      suggestedUsdAt1k: 0,
      suggestedUsdAt100: 0,
    };
  }
  if (truth.formTrend === "deteriorating" && truth.roi7d < -0.05) {
    return {
      ...decision,
      recommendation: "WATCH",
      weaknesses: [...decision.weaknesses, "copy decay: deteriorating + weak 7d ROI"],
      suggestedAllocationPct: decision.suggestedAllocationPct * 0.5,
      suggestedUsdAt10k: Math.round(decision.suggestedUsdAt10k * 0.5),
      suggestedUsdAt1k: Math.round(decision.suggestedUsdAt1k * 0.5),
      suggestedUsdAt100: Math.round(decision.suggestedUsdAt100 * 0.5),
    };
  }
  return decision;
}

export function applyRiskToDecision(
  decision: CopyDecision,
  truth: TraderTruthMetrics,
): CopyDecision {
  let next = applyCopyDecay(decision, truth);
  const dd = evaluateTraderDrawdownDisable(truth);
  if (dd.disabled && next.recommendation === "COPY") {
    return {
      ...next,
      recommendation: "AVOID",
      weaknesses: [...next.weaknesses, dd.reason ?? "risk disable"],
      suggestedAllocationPct: 0,
      suggestedUsdAt10k: 0,
      suggestedUsdAt1k: 0,
      suggestedUsdAt100: 0,
    };
  }
  const capped = capAllocationPct(next.suggestedAllocationPct);
  if (capped < next.suggestedAllocationPct) {
    return {
      ...next,
      suggestedAllocationPct: capped,
      suggestedUsdAt10k: Math.round(10_000 * capped * 100) / 100,
      suggestedUsdAt1k: Math.round(1_000 * capped * 100) / 100,
      suggestedUsdAt100: Math.round(100 * capped * 100) / 100,
      weaknesses: [...next.weaknesses, "allocation capped at 5% per trader"],
    };
  }
  return next;
}
