import { prisma } from "./client.js";
import {
  closedPositionRoi,
  parseCloseReasonFromReasoning,
  recomputeClosedPayout,
  roiAnomalyTier,
  validateClosedPayout,
} from "@augurium/shadow";

export interface ShadowTrustRepairResult {
  examined: number;
  repaired: number;
  flaggedInvalid: number;
  dryRun: boolean;
  auditTrail: Array<{ shadowId: string; action: string; detail: string }>;
}

export interface ShadowTrustRepairReport extends ShadowTrustRepairResult {
  remainingAnomalies: number;
  analyticsTrustworthy: boolean;
}

/**
 * Audit ROI anomalies: provable payout fix → update; else invalidForAnalytics.
 * Never fabricates prices or PnL.
 */
export async function repairShadowTrustAnomalies(
  dryRun: boolean,
  sampleLimit = 5000,
): Promise<ShadowTrustRepairResult> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] }, invalidForAnalytics: false },
    include: { market: { select: { resolved: true } } },
    orderBy: { closedAt: "desc" },
    take: sampleLimit,
  });

  let repaired = 0;
  let flaggedInvalid = 0;
  const auditTrail: ShadowTrustRepairResult["auditTrail"] = [];

  for (const t of trades) {
    const authoritativeRoi = closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd);
    const tier = roiAnomalyTier(authoritativeRoi);
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

    const validation = validateClosedPayout({
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

    const hasAnomaly = tier != null || !validation.valid;
    if (!hasAnomaly) continue;

    if (
      recomputed.reconcilable &&
      Math.abs(t.realizedPnl - recomputed.realizedPnl) > 0.01
    ) {
      if (!dryRun) {
        await prisma.shadowTrade.update({
          where: { id: t.id },
          data: {
            realizedPnl: recomputed.realizedPnl,
            roi: recomputed.roi,
            payoutFormula: recomputed.formula,
            payoutDiagnostic: recomputed.diagnostic ?? null,
            invalidForAnalytics: recomputed.invalidForAnalytics,
          },
        });
      }
      repaired++;
      auditTrail.push({
        shadowId: t.id,
        action: "repaired_payout",
        detail: recomputed.formula ?? "recomputed",
      });
      continue;
    }

    if (!dryRun) {
      await prisma.shadowTrade.update({
        where: { id: t.id },
        data: {
          invalidForAnalytics: true,
          payoutDiagnostic:
            validation.diagnostic ?? recomputed.diagnostic ?? tier ?? "roi_anomaly_unreconcilable",
        },
      });
    }
    flaggedInvalid++;
    auditTrail.push({
      shadowId: t.id,
      action: "flagged_invalid",
      detail: String(validation.diagnostic ?? tier ?? "anomaly"),
    });
  }

  return {
    examined: trades.length,
    repaired,
    flaggedInvalid,
    dryRun,
    auditTrail: auditTrail.slice(0, 200),
  };
}

export async function buildShadowTrustRepairReport(
  dryRun: boolean,
): Promise<ShadowTrustRepairReport> {
  const result = await repairShadowTrustAnomalies(dryRun);
  const { computeShadowAnalytics } = await import("./shadow-analytics.js");
  const shadow = await computeShadowAnalytics();
  return {
    ...result,
    remainingAnomalies: shadow.corruptRoiCount,
    analyticsTrustworthy: shadow.analyticsTrustworthy,
  };
}
