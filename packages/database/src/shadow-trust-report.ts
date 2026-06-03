import { prisma } from "./client.js";
import {
  recomputeClosedPayout,
  parseCloseReasonFromReasoning,
  validateClosedPayout,
} from "@augurium/shadow";
import { countImpossiblePnl } from "./shadow-payout-audit.js";

export interface ShadowTrustReport {
  sampleSize: number;
  impossiblePnlCount: number;
  invalidForAnalyticsCount: number;
  formulaMismatchCount: number;
  flatEntryExitOk: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  trustworthy: boolean;
  generatedAt: string;
}

export async function computeShadowTrustReport(
  sampleLimit = 200,
): Promise<ShadowTrustReport> {
  const [impossiblePnlCount, invalidForAnalyticsCount, trades] = await Promise.all([
    countImpossiblePnl(),
    prisma.shadowTrade.count({
      where: { invalidForAnalytics: true, status: { in: ["CLOSED", "EXPIRED"] } },
    }),
    prisma.shadowTrade.findMany({
      where: { status: { in: ["CLOSED", "EXPIRED"] } },
      include: { market: { select: { resolved: true } } },
      orderBy: { closedAt: "desc" },
      take: sampleLimit,
    }),
  ]);

  const checks: ShadowTrustReport["checks"] = [];
  let formulaMismatchCount = 0;
  let flatSamples = 0;
  let flatOk = 0;

  for (const t of trades) {
    const closeReason =
      t.closeReason ?? parseCloseReasonFromReasoning(t.latestReasoning, t.status);
    const recomputed = recomputeClosedPayout({
      entryPrice: t.simulatedEntryPrice,
      exitPrice: t.currentPrice,
      costBasis: t.simulatedSizeUsd,
      outcomeSide: t.side,
      partialExitDone: t.partialExitDone,
      closeReason,
      marketResolved: t.market.resolved,
      storedRealizedPnl: t.realizedPnl,
    });

    const v = validateClosedPayout({
      entryPrice: t.simulatedEntryPrice,
      exitPrice: t.currentPrice,
      costBasis: t.simulatedSizeUsd,
      realizedPnl: t.realizedPnl,
      outcomeSide: t.side,
      formula: recomputed.formula,
      partialExitDone: t.partialExitDone,
      positionRemainingAtClose: t.positionRemaining,
      priorRealizedPnl: 0,
    });

    if (!v.valid && v.diagnostic === "pnl_formula_mismatch") formulaMismatchCount++;
    if (Math.abs(t.currentPrice - t.simulatedEntryPrice) < 1e-9) {
      flatSamples++;
      if (Math.abs(t.realizedPnl) < 0.01) flatOk++;
    }
  }

  const flatEntryExitOk = flatSamples === 0 || flatOk === flatSamples;
  checks.push({
    name: "entry_equals_exit_pnl_zero",
    pass: flatEntryExitOk && impossiblePnlCount === 0,
    detail: `${flatOk}/${flatSamples} flat closes with ~0 PnL; impossible=${impossiblePnlCount}`,
  });
  checks.push({
    name: "payout_formula_consistency",
    pass: formulaMismatchCount === 0,
    detail: `${formulaMismatchCount} mismatches in sample of ${trades.length}`,
  });
  checks.push({
    name: "invalid_rows_flagged",
    pass: true,
    detail: `${invalidForAnalyticsCount} rows marked invalid_for_analytics`,
  });

  const trustworthy =
    impossiblePnlCount === 0 &&
    flatEntryExitOk &&
    formulaMismatchCount === 0;

  return {
    sampleSize: trades.length,
    impossiblePnlCount,
    invalidForAnalyticsCount,
    formulaMismatchCount,
    flatEntryExitOk,
    checks,
    trustworthy,
    generatedAt: new Date().toISOString(),
  };
}
