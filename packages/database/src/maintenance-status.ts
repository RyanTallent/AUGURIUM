import { prisma } from "./client.js";

export const MAINTENANCE_SOURCE_PRODUCTION = "maintenance:production";
export const MAINTENANCE_SOURCE_DAILY = "maintenance:daily";

export interface MaintenanceRunSummary {
  id: string;
  source: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  dryRun: boolean;
  before: MaintenanceMetricsLike | null;
  after: MaintenanceMetricsLike | null;
  steps: MaintenanceStepResult[];
  error: string | null;
}

export interface MaintenanceMetricsLike {
  impossiblePnlCount?: number;
  roiAnomalyCount?: number;
  invalidForAnalyticsCount?: number;
  duplicateActiveGroups?: number;
  categoryCoveragePct?: number;
  scoringEligibleBacklog?: number;
  shadowFreshPct?: number;
  shadowStalePct?: number;
  ingestionFailedRuns24h?: number;
  workerMemoryHeapUsedMb?: number | null;
  readinessScore?: number;
  liveTradingReady?: boolean;
}

export interface MaintenanceStepResult {
  name: string;
  status: "ok" | "skipped" | "failed" | "dry_run";
  detail?: Record<string, unknown>;
  error?: string;
}

export async function getLastMaintenanceRun(
  source?: string,
): Promise<MaintenanceRunSummary | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: source
      ? { source }
      : { source: { in: [MAINTENANCE_SOURCE_PRODUCTION, MAINTENANCE_SOURCE_DAILY] } },
    orderBy: { startedAt: "desc" },
  });
  if (!run) return null;
  const meta = (run.metadata ?? {}) as Record<string, unknown>;
  return {
    id: run.id,
    source: run.source,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    dryRun: Boolean(meta.dryRun),
    before: (meta.before as MaintenanceMetricsLike) ?? null,
    after: (meta.after as MaintenanceMetricsLike) ?? null,
    steps: (meta.steps as MaintenanceStepResult[]) ?? [],
    error: run.error,
  };
}

export async function getLastWorkerMemoryFromRuns(): Promise<{
  heapUsedMb: number;
  highWatermark: boolean;
} | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: {
      source: { in: [MAINTENANCE_SOURCE_PRODUCTION, MAINTENANCE_SOURCE_DAILY] },
      status: "success",
    },
    orderBy: { finishedAt: "desc" },
  });
  const meta = (run?.metadata ?? {}) as Record<string, unknown>;
  const mem = meta.workerMemory as { heapUsedMb?: number; highWatermark?: boolean } | undefined;
  if (!mem || typeof mem.heapUsedMb !== "number") return null;
  return {
    heapUsedMb: mem.heapUsedMb,
    highWatermark: Boolean(mem.highWatermark),
  };
}
