import { prisma } from "./client.js";

export interface ProductionHealthReport {
  walletsTotal: number;
  scoredWallets: number;
  unscoredEligibleRemaining: number;
  scoreCoveragePct: number;
  shadowTotal: number;
  shadowFresh: number;
  shadowStale: number;
  shadowFreshPct: number;
  shadowStalePct: number;
  shadowPriceStatusCounts: Record<string, number>;
  latestScoreTradersRun: IngestionRunSummary | null;
  latestShadowSyncRun: IngestionRunSummary | null;
  generatedAt: string;
}

export interface IngestionRunSummary {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  itemCount: number | null;
  metadata: unknown;
}

const MIN_TRADES_ELIGIBLE = Number(process.env.SCORE_MIN_TRADES ?? "5");

export async function getProductionHealthReport(): Promise<ProductionHealthReport> {
  const eligibleWhere = {
    trades: { gte: MIN_TRADES_ELIGIBLE },
    tradeRows: { some: { size: { gt: 0 } } },
  } as const;

  const [
    walletsTotal,
    scoredWallets,
    unscoredEligibleRemaining,
    shadowTotal,
    shadowGrouped,
    latestScoreTradersRun,
    latestShadowSyncRun,
  ] = await Promise.all([
    prisma.trader.count(),
    prisma.trader.count({ where: { lastScoredAt: { not: null } } }),
    prisma.trader.count({
      where: { ...eligibleWhere, lastScoredAt: null },
    }),
    prisma.shadowTrade.count(),
    prisma.shadowTrade.groupBy({ by: ["priceStatus"], _count: true }),
    prisma.ingestionRun.findFirst({
      where: { source: "score-traders" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.ingestionRun.findFirst({
      where: { source: "shadow-portfolio" },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const shadowPriceStatusCounts = Object.fromEntries(
    shadowGrouped.map((g) => [g.priceStatus ?? "unknown", g._count]),
  );
  const shadowFresh = shadowPriceStatusCounts.FRESH ?? 0;
  const shadowStale = shadowPriceStatusCounts.STALE ?? 0;
  const scoreCoveragePct =
    walletsTotal > 0 ? Number(((scoredWallets / walletsTotal) * 100).toFixed(1)) : 0;
  const shadowFreshPct =
    shadowTotal > 0 ? Number(((shadowFresh / shadowTotal) * 100).toFixed(1)) : 0;
  const shadowStalePct =
    shadowTotal > 0 ? Number(((shadowStale / shadowTotal) * 100).toFixed(1)) : 0;

  return {
    walletsTotal,
    scoredWallets,
    unscoredEligibleRemaining,
    scoreCoveragePct,
    shadowTotal,
    shadowFresh,
    shadowStale,
    shadowFreshPct,
    shadowStalePct,
    shadowPriceStatusCounts,
    latestScoreTradersRun: mapRun(latestScoreTradersRun),
    latestShadowSyncRun: mapRun(latestShadowSyncRun),
    generatedAt: new Date().toISOString(),
  };
}

function mapRun(
  run: {
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    itemCount: number | null;
    metadata: unknown;
  } | null,
): IngestionRunSummary | null {
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    itemCount: run.itemCount,
    metadata: run.metadata,
  };
}
