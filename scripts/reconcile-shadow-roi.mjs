#!/usr/bin/env node
/**
 * Reconcile stored ShadowTrade.roi with authoritative realizedPnl/sizeUsd (truth, not fabrication).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const TOLERANCE = 0.02;

function closedRoi(realizedPnl, sizeUsd) {
  if (sizeUsd <= 0) return 0;
  return realizedPnl / sizeUsd;
}

async function main() {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    select: { id: true, roi: true, realizedPnl: true, simulatedSizeUsd: true },
  });

  let updated = 0;
  for (const t of trades) {
    const auth = closedRoi(t.realizedPnl, t.simulatedSizeUsd);
    if (Math.abs(t.roi - auth) <= TOLERANCE) continue;
    if (!DRY_RUN) {
      await prisma.shadowTrade.update({
        where: { id: t.id },
        data: { roi: auth },
      });
    }
    updated++;
  }

  console.log(
    DRY_RUN
      ? `Would reconcile ${updated}/${trades.length} closed shadows`
      : `Reconciled ${updated}/${trades.length} closed shadows`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
