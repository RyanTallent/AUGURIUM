import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const totalTrades = await prisma.trade.count();
  const linkedTrades = await prisma.trade.count({
    where: { marketId: { not: null } },
  });
  const unlinkedTrades = totalTrades - linkedTrades;
  const linkedPct =
    totalTrades > 0 ? Math.round((linkedTrades / totalTrades) * 10000) / 100 : 100;

  const marketsWithCondition = await prisma.market.count({
    where: { conditionId: { not: null } },
  });
  const marketsWithTokens = await prisma.market.count({
    where: { clobTokenIds: { isEmpty: false } },
  });

  const totalPositions = await prisma.position.count();
  const positionsMissingConditionMatch = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count FROM "Position" p
    LEFT JOIN "Market" m ON p."marketId" = m.id
    WHERE m."conditionId" IS NULL OR m."conditionId" != p."conditionId"
  `;
  const positionLinkMismatches = Number(positionsMissingConditionMatch[0]?.count ?? 0);

  const unlinkedRows = await prisma.trade.findMany({
    where: { marketId: null },
    select: { conditionId: true },
  });
  const unlinkedCounts = new Map();
  for (const row of unlinkedRows) {
    unlinkedCounts.set(row.conditionId, (unlinkedCounts.get(row.conditionId) ?? 0) + 1);
  }
  const topUnlinkedConditionIds = [...unlinkedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([conditionId, tradeCount]) => ({ conditionId, tradeCount }));

  const lastDiscover = await prisma.ingestionRun.findFirst({
    where: { source: "polymarket-wallet-discover" },
    orderBy: { startedAt: "desc" },
  });

  const lastLink = await prisma.ingestionRun.findFirst({
    where: { source: "trade-market-link" },
    orderBy: { startedAt: "desc" },
  });

  const sampleTrades = await prisma.trade.findMany({
    take: 5,
    orderBy: { tradedAt: "desc" },
    where: { marketId: { not: null } },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true, conditionId: true, slug: true } },
    },
  });

  const sampleReconstructed = await prisma.position.findMany({
    where: { source: "reconstructed" },
    take: 5,
    orderBy: { syncedAt: "desc" },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true } },
    },
  });

  console.log(
    JSON.stringify(
      {
        trades: {
          total: totalTrades,
          linked: linkedTrades,
          unlinked: unlinkedTrades,
          linkedPct,
        },
        markets: {
          total: await prisma.market.count(),
          withConditionId: marketsWithCondition,
          withClobTokenIds: marketsWithTokens,
        },
        positions: {
          total: totalPositions,
          linked: totalPositions,
          conditionMismatches: positionLinkMismatches,
          reconstructed: await prisma.position.count({
            where: { source: "reconstructed" },
          }),
        },
        holderDiscovery: lastDiscover?.metadata ?? null,
        tradeLinkRun: lastLink?.metadata ?? null,
        topUnlinkedConditionIds,
        sampleLinkedTrades: sampleTrades,
        sampleReconstructedPositions: sampleReconstructed,
        rawPayloads: await prisma.rawApiPayload.count(),
        traders: await prisma.trader.count(),
        syncCursors: await prisma.syncCursor.count(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
