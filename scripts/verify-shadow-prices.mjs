#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.shadowTrade.count();
  const grouped = await prisma.shadowTrade.groupBy({
    by: ["priceStatus"],
    _count: true,
  });
  const nonzeroRoi = await prisma.shadowTrade.count({ where: { roi: { not: 0 } } });
  const nonzeroMfe = await prisma.shadowTrade.count({
    where: { maxFavorableExcursion: { not: 0 } },
  });
  const nonzeroMae = await prisma.shadowTrade.count({
    where: { maxAdverseExcursion: { not: 0 } },
  });
  const avgRoi = await prisma.shadowTrade.aggregate({ _avg: { roi: true } });
  const withUpdates = await prisma.shadowTrade.count({
    where: { lastPriceUpdateAt: { not: null } },
  });

  const byStatus = Object.fromEntries(grouped.map((g) => [g.priceStatus, g._count]));

  const report = {
    passed: total === 0 || withUpdates > 0 || nonzeroRoi > 0,
    totalShadowTrades: total,
    tradesWithPriceUpdates: withUpdates,
    priceStatusCounts: byStatus,
    staleTrades: byStatus.STALE ?? 0,
    noPriceSourceTrades: byStatus.NO_PRICE_SOURCE ?? 0,
    nonzeroRoiCount: nonzeroRoi,
    nonzeroMfeCount: nonzeroMfe,
    nonzeroMaeCount: nonzeroMae,
    avgRoiPct: Number(((avgRoi._avg.roi ?? 0) * 100).toFixed(2)),
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
