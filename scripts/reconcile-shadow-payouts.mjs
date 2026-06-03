#!/usr/bin/env node
/**
 * Recompute shadow closed payouts from entry/exit; flag or fix corrupt rows.
 * Usage: npm run reconcile:shadow-payouts [-- --dry-run]
 */
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const { parseCloseReasonFromReasoning, recomputeClosedPayout } = require(
  "../packages/shadow/dist/payout-reconcile.js",
);

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
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

    const needsUpdate =
      Math.abs(t.realizedPnl - result.realizedPnl) > 0.5 ||
      Math.abs(t.roi - result.roi) > 0.02 ||
      t.invalidForAnalytics !== result.invalidForAnalytics;

    if (!result.reconcilable) {
      unreconcilable++;
      if (!DRY_RUN) {
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

    if (needsUpdate) {
      fixed++;
      if (!DRY_RUN) {
        await prisma.shadowTrade.update({
          where: { id: t.id },
          data: {
            realizedPnl: result.realizedPnl,
            roi: result.roi,
            unrealizedPnl: 0,
            positionRemaining: 0,
            payoutFormula: result.formula,
            payoutDiagnostic: result.diagnostic,
            invalidForAnalytics: result.invalidForAnalytics,
            closeReason: closeReason.slice(0, 200),
          },
        });
      }
    }
  }

  console.log("=== reconcile:shadow-payouts ===");
  console.log(`Closed/expired: ${trades.length}`);
  console.log(DRY_RUN ? `Would fix: ${fixed}` : `Fixed: ${fixed}`);
  console.log(`Invalid flagged: ${flagged}`);
  console.log(`Unreconcilable: ${unreconcilable}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
