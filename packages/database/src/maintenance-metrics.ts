import { prisma } from "./client.js";
import { countImpossiblePnl } from "./shadow-payout-audit.js";
import { auditShadowDuplicates } from "./shadow-duplicates.js";
import { computeShadowRoiForensics } from "./shadow-roi-forensics.js";
import { computeLiveTradingReadiness } from "./readiness-report.js";
import { getProductionHealthReport } from "./production-health.js";
import { getLastWorkerMemoryFromRuns } from "./maintenance-status.js";

export interface MaintenanceMetricsSnapshot {
  impossiblePnlCount: number;
  roiAnomalyCount: number;
  invalidForAnalyticsCount: number;
  duplicateActiveGroups: number;
  categoryCoveragePct: number;
  categorizedMarkets: number;
  totalMarkets: number;
  scoringEligibleBacklog: number;
  shadowFreshPct: number;
  shadowStalePct: number;
  ingestionFailedRuns24h: number;
  workerMemoryHeapUsedMb: number | null;
  workerMemoryHigh: boolean;
  readinessScore: number;
  liveTradingReady: boolean;
  generatedAt: string;
}

export async function collectMaintenanceMetrics(): Promise<MaintenanceMetricsSnapshot> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    impossiblePnlCount,
    forensics,
    invalidForAnalyticsCount,
    duplicates,
    readiness,
    health,
    totalMarkets,
    categorizedMarkets,
    ingestionFailedRuns24h,
    workerMem,
  ] = await Promise.all([
    countImpossiblePnl(),
    computeShadowRoiForensics(),
    prisma.shadowTrade.count({
      where: { invalidForAnalytics: true, status: { in: ["CLOSED", "EXPIRED"] } },
    }),
    auditShadowDuplicates(),
    computeLiveTradingReadiness(),
    getProductionHealthReport(),
    prisma.market.count(),
    prisma.market.count({
      where: {
        AND: [
          { category: { not: null } },
          { category: { notIn: ["", "Other", "uncategorized"] } },
        ],
      },
    }),
    prisma.ingestionRun.count({
      where: {
        status: "failed",
        startedAt: { gte: since24h },
      },
    }),
    getLastWorkerMemoryFromRuns(),
  ]);

  const categoryCoveragePct =
    totalMarkets > 0
      ? Number(((categorizedMarkets / totalMarkets) * 100).toFixed(1))
      : 0;

  return {
    impossiblePnlCount,
    roiAnomalyCount: forensics.corruptTradeCount,
    invalidForAnalyticsCount,
    duplicateActiveGroups: duplicates.duplicateActiveGroups,
    categoryCoveragePct,
    categorizedMarkets,
    totalMarkets,
    scoringEligibleBacklog: health.unscoredEligibleRemaining,
    shadowFreshPct: health.shadowFreshPct,
    shadowStalePct: health.shadowStalePct,
    ingestionFailedRuns24h,
    workerMemoryHeapUsedMb: workerMem?.heapUsedMb ?? null,
    workerMemoryHigh: workerMem?.highWatermark ?? false,
    readinessScore: readiness.overallScore,
    liveTradingReady: readiness.liveTradingReady,
    generatedAt: new Date().toISOString(),
  };
}
