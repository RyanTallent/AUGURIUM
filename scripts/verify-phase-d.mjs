import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.shadowTrade.count();
  const open = await prisma.shadowTrade.count({ where: { status: "OPEN" } });
  const closed = await prisma.shadowTrade.count({ where: { status: "CLOSED" } });
  const expired = await prisma.shadowTrade.count({ where: { status: "EXPIRED" } });

  const avgRoi = await prisma.shadowTrade.aggregate({
    _avg: { roi: true, realizedPnl: true, maxFavorableExcursion: true },
  });

  const bySignalType = await prisma.shadowTrade.findMany({
    select: {
      roi: true,
      signal: { select: { signalType: true } },
    },
  });

  const typeStats = {};
  for (const row of bySignalType) {
    const t = row.signal.signalType;
    if (!typeStats[t]) typeStats[t] = { sum: 0, n: 0 };
    typeStats[t].sum += row.roi;
    typeStats[t].n += 1;
  }
  const signalTypeRoi = Object.entries(typeStats).map(([type, v]) => ({
    type,
    avgRoi: v.n ? v.sum / v.n : 0,
    count: v.n,
  }));
  signalTypeRoi.sort((a, b) => b.avgRoi - a.avgRoi);

  const strategyCompare = await prisma.simulationResult.groupBy({
    by: ["strategyName"],
    _avg: { roi: true },
    _count: true,
  });

  const partialHelped = await prisma.shadowTrade.findMany({
    where: { partialExitDone: true, status: { in: ["CLOSED", "EXPIRED"] } },
    take: 5,
    orderBy: { roi: "desc" },
    include: { market: { select: { title: true } }, signal: { select: { signalType: true } } },
  });

  const holdBetter = await prisma.shadowTrade.findMany({
    where: { wouldHaveBeenBetterToHold: true },
    take: 5,
    include: { market: { select: { title: true } } },
  });

  const replayCount = await prisma.replaySnapshot.count();
  const simCount = await prisma.simulationResult.count();

  const lastRun = await prisma.ingestionRun.findFirst({
    where: { source: "shadow-portfolio" },
    orderBy: { startedAt: "desc" },
  });

  const duplicates = await prisma.$queryRaw`
    SELECT "signalId", COUNT(*)::int AS c FROM "ShadowTrade" GROUP BY "signalId" HAVING COUNT(*) > 1
  `;

  const passed = total > 0 && replayCount > 0 && simCount > 0 && duplicates.length === 0;

  console.log(
    JSON.stringify(
      {
        phase: "D",
        passed,
        counts: {
          shadowTrades: total,
          open,
          closed,
          expired,
          simulationResults: simCount,
          replaySnapshots: replayCount,
        },
        averageShadowRoi: avgRoi._avg.roi ?? 0,
        bestSignalType: signalTypeRoi[0] ?? null,
        worstSignalType: signalTypeRoi[signalTypeRoi.length - 1] ?? null,
        signalTypeBreakdown: signalTypeRoi,
        simulationStrategyComparison: strategyCompare
          .map((s) => ({
            strategy: s.strategyName,
            avgRoi: s._avg.roi,
            count: s._count,
          }))
          .sort((a, b) => (b.avgRoi ?? 0) - (a.avgRoi ?? 0)),
        examplesPartialExitHelped: partialHelped.map((t) => ({
          market: t.market.title,
          signalType: t.signal.signalType,
          roi: t.roi,
          realizedPnl: t.realizedPnl,
          mfe: t.maxFavorableExcursion,
        })),
        examplesHoldWouldHaveHelped: holdBetter.map((t) => ({
          market: t.market.title,
          roi: t.roi,
          missedProfit: t.missedProfitAfterExit,
          mfe: t.maxFavorableExcursion,
        })),
        duplicateShadowTrades: duplicates,
        lastShadowRun: lastRun,
        safety: {
          liveExecution: false,
          randomData: false,
        },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
