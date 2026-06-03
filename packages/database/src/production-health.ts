import { prisma } from "./client.js";
import { computeScoringHealth } from "./scoring-health.js";
import {
  isShadowSyncRunAcceptable,
  parseShadowSyncRunOutcome,
} from "./shadow-sync-health.js";

export interface ShadowSyncRunStats {
  selected: number | null;
  processed: number;
  updated: number | null;
  fresh: number;
  stale: number;
  noSource: number;
  noUpdate: number;
  closed: number;
}

export interface ProductionHealthReport {
  walletsTotal: number;
  scoredWallets: number;
  unscoredEligibleRemaining: number;
  eligibleWallets: number;
  scoreCoverageEligiblePct: number;
  scoringHealthy: boolean;
  /** @deprecated Use scoreCoverageEligiblePct (eligible-wallet denominator). */
  scoreCoveragePct: number;
  shadowTotal: number;
  shadowFresh: number;
  shadowStale: number;
  shadowFreshPct: number;
  shadowStalePct: number;
  shadowPriceStatusCounts: Record<string, number>;
  latestScoreTradersRun: IngestionRunSummary | null;
  latestShadowSyncRun: IngestionRunSummary | null;
  latestShadowSyncCompleted: IngestionRunSummary | null;
  latestShadowSyncRunning: IngestionRunSummary | null;
  shadowSyncOrphanedRunningCount: number;
  latestShadowSyncSelected: number | null;
  latestShadowSyncProcessed: number | null;
  latestShadowSyncUpdated: number | null;
  shadowSyncPartialTimeout: boolean;
  shadowSyncRunAcceptable: boolean;
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
const SHADOW_ORPHAN_MS = Number(process.env.SHADOW_SYNC_ORPHAN_MS ?? String(10 * 60 * 1000));

export function parseShadowSyncStats(metadata: unknown): ShadowSyncRunStats | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;

  if (typeof m.processed === "number") {
    return {
      selected: typeof m.selected === "number" ? m.selected : null,
      processed: m.processed,
      updated: typeof m.updated === "number" ? m.updated : null,
      fresh: typeof m.fresh === "number" ? m.fresh : 0,
      stale: typeof m.stale === "number" ? m.stale : 0,
      noSource: typeof m.noSource === "number" ? m.noSource : 0,
      noUpdate: typeof m.noUpdate === "number" ? m.noUpdate : 0,
      closed: typeof m.closed === "number" ? m.closed : 0,
    };
  }

  if (typeof m.updated === "number") {
    const updated = m.updated;
    const created = typeof m.created === "number" ? m.created : 0;
    return {
      selected: null,
      processed: updated + created,
      updated,
      fresh: typeof m.priceFresh === "number" ? m.priceFresh : 0,
      stale: typeof m.priceStale === "number" ? m.priceStale : 0,
      noSource: typeof m.priceNoSource === "number" ? m.priceNoSource : 0,
      noUpdate: typeof m.priceNoUpdate === "number" ? m.priceNoUpdate : 0,
      closed: typeof m.closed === "number" ? m.closed : 0,
    };
  }

  return null;
}

export async function getProductionHealthReport(): Promise<ProductionHealthReport> {
  const eligibleWhere = {
    trades: { gte: MIN_TRADES_ELIGIBLE },
    tradeRows: { some: { size: { gt: 0 } } },
  } as const;

  const orphanCutoff = new Date(Date.now() - SHADOW_ORPHAN_MS);

  const [
    walletsTotal,
    scoredWallets,
    unscoredEligibleRemaining,
    shadowTotal,
    shadowGrouped,
    latestScoreTradersRun,
    latestShadowSyncRun,
    latestShadowSyncCompleted,
    latestShadowSyncRunning,
    shadowSyncOrphanedRunningCount,
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
    prisma.ingestionRun.findFirst({
      where: {
        source: "shadow-portfolio",
        finishedAt: { not: null },
        status: { in: ["success", "error", "failed_orphaned"] },
      },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.ingestionRun.findFirst({
      where: { source: "shadow-portfolio", status: "running" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.ingestionRun.count({
      where: {
        source: "shadow-portfolio",
        status: "running",
        startedAt: { lt: orphanCutoff },
      },
    }),
  ]);

  const shadowPriceStatusCounts = Object.fromEntries(
    shadowGrouped.map((g) => [g.priceStatus ?? "unknown", g._count]),
  );
  const shadowFresh = shadowPriceStatusCounts.FRESH ?? 0;
  const shadowStale = shadowPriceStatusCounts.STALE ?? 0;
  const scoring = computeScoringHealth(scoredWallets, unscoredEligibleRemaining);
  const shadowFreshPct =
    shadowTotal > 0 ? Number(((shadowFresh / shadowTotal) * 100).toFixed(1)) : 0;
  const shadowStalePct =
    shadowTotal > 0 ? Number(((shadowStale / shadowTotal) * 100).toFixed(1)) : 0;

  const completedStats = parseShadowSyncStats(latestShadowSyncCompleted?.metadata);
  const latestStats = parseShadowSyncStats(latestShadowSyncRun?.metadata);
  const latestOutcome = parseShadowSyncRunOutcome(
    mapRun(latestShadowSyncCompleted) ?? mapRun(latestShadowSyncRun),
  );
  const shadowSyncPartialTimeout = latestOutcome?.partialTimeout ?? false;
  const shadowSyncRunAcceptable = isShadowSyncRunAcceptable(latestOutcome);

  return {
    walletsTotal,
    scoredWallets: scoring.scoredWallets,
    unscoredEligibleRemaining: scoring.unscoredEligibleRemaining,
    eligibleWallets: scoring.eligibleWallets,
    scoreCoverageEligiblePct: scoring.scoreCoverageEligiblePct,
    scoringHealthy: scoring.scoringHealthy,
    scoreCoveragePct: scoring.scoreCoverageEligiblePct,
    shadowTotal,
    shadowFresh,
    shadowStale,
    shadowFreshPct,
    shadowStalePct,
    shadowPriceStatusCounts,
    latestScoreTradersRun: mapRun(latestScoreTradersRun),
    latestShadowSyncRun: mapRun(latestShadowSyncRun),
    latestShadowSyncCompleted: mapRun(latestShadowSyncCompleted),
    latestShadowSyncRunning: mapRun(latestShadowSyncRunning),
    shadowSyncOrphanedRunningCount,
    latestShadowSyncSelected:
      latestStats?.selected ?? completedStats?.selected ?? null,
    latestShadowSyncProcessed:
      latestStats?.processed ??
      completedStats?.processed ??
      latestShadowSyncRun?.itemCount ??
      null,
    latestShadowSyncUpdated:
      latestStats?.updated ?? completedStats?.updated ?? null,
    shadowSyncPartialTimeout,
    shadowSyncRunAcceptable,
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
