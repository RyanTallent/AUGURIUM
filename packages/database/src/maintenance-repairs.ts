import { prisma } from "./client.js";
import {
  isImpossibleFlatPnl,
  parseCloseReasonFromReasoning,
  recomputeClosedPayout,
} from "@augurium/shadow";

export interface ImpossibleFlatPnlFixResult {
  examined: number;
  fixed: number;
  dryRun: boolean;
}

/** Provably flat entry≈exit with nonzero PnL → zero out (no fabricated prices). */
export async function fixImpossibleFlatPnl(
  dryRun: boolean,
): Promise<ImpossibleFlatPnlFixResult> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    select: {
      id: true,
      simulatedEntryPrice: true,
      currentPrice: true,
      realizedPnl: true,
    },
  });

  let fixed = 0;
  for (const t of trades) {
    if (!isImpossibleFlatPnl(t.simulatedEntryPrice, t.currentPrice, t.realizedPnl)) {
      continue;
    }
    if (!dryRun) {
      await prisma.shadowTrade.update({
        where: { id: t.id },
        data: {
          realizedPnl: 0,
          roi: 0,
          payoutFormula: "mark_to_market",
          payoutDiagnostic: "entry_equals_exit_corrected",
          invalidForAnalytics: false,
        },
      });
    }
    fixed++;
  }

  return { examined: trades.length, fixed, dryRun };
}

export interface DuplicateCleanupResult {
  groupsAffected: number;
  closed: number;
  dryRun: boolean;
}

export async function cleanupDuplicateShadows(
  dryRun: boolean,
): Promise<DuplicateCleanupResult> {
  const open = await prisma.shadowTrade.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      marketId: true,
      side: true,
      signalType: true,
      createdAt: true,
    },
  });

  const groups = new Map<string, typeof open>();
  for (const row of open) {
    const key = `${row.marketId}|${row.side}|${row.signalType}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let closed = 0;
  let groupsAffected = 0;

  for (const rows of groups.values()) {
    if (rows.length <= 1) continue;
    groupsAffected++;
    const [, ...dupes] = rows;
    for (const d of dupes) {
      if (!dryRun) {
        await prisma.shadowTrade.update({
          where: { id: d.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            latestReasoning: "Closed: duplicate active position cleanup",
            positionRemaining: 0,
            unrealizedPnl: 0,
            closeReason: "duplicate_cleanup",
          },
        });
      }
      closed++;
    }
  }

  return { groupsAffected, closed, dryRun };
}

export interface PayoutReconcileResult {
  examined: number;
  fixed: number;
  flagged: number;
  unreconcilable: number;
  dryRun: boolean;
}

export async function reconcileShadowPayouts(
  dryRun: boolean,
): Promise<PayoutReconcileResult> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    include: { market: { select: { resolved: true } } },
  });

  let fixed = 0;
  let flagged = 0;
  let unreconcilable = 0;

  for (const t of trades) {
    const closeReason =
      t.closeReason ?? parseCloseReasonFromReasoning(t.latestReasoning, t.status);
    const result = recomputeClosedPayout({
      entryPrice: t.simulatedEntryPrice,
      exitPrice: t.currentPrice,
      costBasis: t.simulatedSizeUsd,
      outcomeSide: t.side,
      partialExitDone: t.partialExitDone,
      closeReason,
      marketResolved: t.market.resolved,
      storedRealizedPnl: t.realizedPnl,
    });

    if (!result.reconcilable) {
      unreconcilable++;
      if (!dryRun) {
        await prisma.shadowTrade.update({
          where: { id: t.id },
          data: {
            invalidForAnalytics: true,
            payoutDiagnostic: result.diagnostic ?? "unreconcilable",
          },
        });
      }
      continue;
    }

    if (result.invalidForAnalytics) flagged++;

    const needsUpdate =
      Math.abs(t.realizedPnl - result.realizedPnl) > 0.5 ||
      Math.abs(t.roi - result.roi) > 0.02 ||
      t.invalidForAnalytics !== result.invalidForAnalytics;

    if (needsUpdate && !dryRun) {
      await prisma.shadowTrade.update({
        where: { id: t.id },
        data: {
          realizedPnl: result.realizedPnl,
          roi: result.roi,
          payoutFormula: result.formula,
          payoutDiagnostic: result.diagnostic,
          invalidForAnalytics: result.invalidForAnalytics,
        },
      });
      fixed++;
    } else if (needsUpdate && dryRun) {
      fixed++;
    }
  }

  return {
    examined: trades.length,
    fixed,
    flagged,
    unreconcilable,
    dryRun,
  };
}

export async function countStaleRunningIngestionRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  return prisma.ingestionRun.count({
    where: { status: "running", startedAt: { lt: cutoff } },
  });
}
