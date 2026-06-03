import { prisma } from "./client.js";
import {
  closedPositionRoi,
  recomputeClosedPayout,
  parseCloseReasonFromReasoning,
  validateClosedPayout,
  roiAnomalyTier,
} from "@augurium/shadow";

export interface PayoutAuditRow {
  id: string;
  marketTitle: string;
  side: string;
  signalType: string;
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  realizedPnl: number;
  roi: number;
  closeReason: string;
  payoutFormula: string | null;
  diagnostic: string | null;
  invalidForAnalytics: boolean;
  formulaUsed: string;
}

export interface ShadowPayoutAuditReport {
  totalClosed: number;
  invalidCount: number;
  impossiblePnlCount: number;
  roiGt100: number;
  roiGt500: number;
  roiGt1000: number;
  duplicateCloseCount: number;
  rows: PayoutAuditRow[];
  generatedAt: string;
}

export async function computeShadowPayoutAudit(limit = 100): Promise<ShadowPayoutAuditReport> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    include: { market: { select: { title: true, resolved: true } } },
    orderBy: { closedAt: "desc" },
    take: 5000,
  });

  const rows: PayoutAuditRow[] = [];
  let impossiblePnlCount = 0;
  let roiGt100 = 0;
  let roiGt500 = 0;
  let roiGt1000 = 0;
  let invalidCount = 0;

  for (const t of trades) {
    const closeReason =
      t.closeReason ?? parseCloseReasonFromReasoning(t.latestReasoning, t.status);
    const exitPrice = t.currentPrice;
    const entryPrice = t.simulatedEntryPrice;
    const costBasis = t.simulatedSizeUsd;

    const recomputed = recomputeClosedPayout({
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide: t.side,
      partialExitDone: t.partialExitDone,
      closeReason,
      marketResolved: t.market.resolved,
      storedRealizedPnl: t.realizedPnl,
    });

    const flatBad =
      Math.abs(exitPrice - entryPrice) < 1e-9 && Math.abs(t.realizedPnl) > 0.01;
    if (flatBad) impossiblePnlCount++;

    const authRoi = closedPositionRoi(t.realizedPnl, costBasis);
    const tier = roiAnomalyTier(authRoi);
    if (authRoi > 1) roiGt100++;
    if (authRoi > 5) roiGt500++;
    if (authRoi > 10) roiGt1000++;

    const invalid =
      t.invalidForAnalytics ||
      recomputed.invalidForAnalytics ||
      flatBad ||
      !recomputed.reconcilable;
    if (invalid) invalidCount++;

    const validation = validateClosedPayout({
      entryPrice,
      exitPrice,
      costBasis,
      realizedPnl: t.realizedPnl,
      outcomeSide: t.side,
      formula: (t.payoutFormula as "mark_to_market") ?? recomputed.formula,
      partialExitDone: t.partialExitDone,
      positionRemainingAtClose: 0,
      priorRealizedPnl: 0,
    });

    rows.push({
      id: t.id,
      marketTitle: t.market.title,
      side: t.side,
      signalType: t.signalType,
      entryPrice,
      exitPrice,
      costBasis,
      realizedPnl: t.realizedPnl,
      roi: authRoi,
      closeReason,
      payoutFormula: t.payoutFormula,
      diagnostic: t.payoutDiagnostic ?? recomputed.diagnostic ?? validation.diagnostic,
      invalidForAnalytics: invalid,
      formulaUsed: t.payoutFormula ?? recomputed.formula,
    });
  }

  const flagged = rows.filter((r) => r.invalidForAnalytics || r.roi > 1);

  return {
    totalClosed: trades.length,
    invalidCount,
    impossiblePnlCount,
    roiGt100,
    roiGt500,
    roiGt1000,
    duplicateCloseCount: 0,
    rows: flagged.slice(0, limit),
    generatedAt: new Date().toISOString(),
  };
}

export async function countImpossiblePnl(): Promise<number> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    select: {
      simulatedEntryPrice: true,
      currentPrice: true,
      realizedPnl: true,
    },
  });
  return trades.filter(
    (t) =>
      Math.abs(t.currentPrice - t.simulatedEntryPrice) < 1e-9 &&
      Math.abs(t.realizedPnl) > 0.01,
  ).length;
}
