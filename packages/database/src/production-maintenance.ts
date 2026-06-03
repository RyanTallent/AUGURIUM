import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "./client.js";
import { collectMaintenanceMetrics, type MaintenanceMetricsSnapshot } from "./maintenance-metrics.js";
import {
  MAINTENANCE_SOURCE_DAILY,
  MAINTENANCE_SOURCE_PRODUCTION,
  type MaintenanceStepResult,
} from "./maintenance-status.js";
import {
  cleanupDuplicateShadows,
  reconcileShadowPayouts,
} from "./maintenance-repairs.js";
import {
  markOrphanedShadowPortfolioRuns,
  markStaleRunningIngestionRuns,
} from "./maintenance-orphans.js";

export interface ProductionMaintenanceOptions {
  dryRun?: boolean;
  source?: string;
  reportPath?: string;
  skipVerifications?: boolean;
}

export interface ProductionMaintenanceResult {
  runId: string;
  dryRun: boolean;
  status: "success" | "failed";
  before: MaintenanceMetricsSnapshot;
  after: MaintenanceMetricsSnapshot;
  steps: MaintenanceStepResult[];
  reportWritten: string | null;
  error?: string;
}

function formatReportMarkdown(
  before: MaintenanceMetricsSnapshot,
  after: MaintenanceMetricsSnapshot,
  steps: MaintenanceStepResult[],
  dryRun: boolean,
): string {
  const lines = [
    "# PRODUCTION MAINTENANCE REPORT",
    "",
    `Generated: ${after.generatedAt}`,
    `Mode: **${dryRun ? "DRY RUN (no mutations)" : "LIVE REPAIR"}**`,
    "",
    "## Verdict",
    "",
    `**LIVE TRADING READY = ${after.liveTradingReady ? "YES" : "NO"}**`,
    "",
    `Readiness score: **${after.readinessScore}/100** (was ${before.readinessScore})`,
    "",
    "## Metrics (before → after)",
    "",
    "| Metric | Before | After |",
    "|--------|--------|-------|",
    `| Impossible PnL | ${before.impossiblePnlCount} | ${after.impossiblePnlCount} |`,
    `| ROI anomalies | ${before.roiAnomalyCount} | ${after.roiAnomalyCount} |`,
    `| invalid_for_analytics | ${before.invalidForAnalyticsCount} | ${after.invalidForAnalyticsCount} |`,
    `| Duplicate active shadow groups | ${before.duplicateActiveGroups} | ${after.duplicateActiveGroups} |`,
    `| Category coverage % | ${before.categoryCoveragePct}% | ${after.categoryCoveragePct}% |`,
    `| Scoring eligible backlog | ${before.scoringEligibleBacklog} | ${after.scoringEligibleBacklog} |`,
    `| Shadow FRESH % | ${before.shadowFreshPct}% | ${after.shadowFreshPct}% |`,
    `| Shadow STALE % | ${before.shadowStalePct}% | ${after.shadowStalePct}% |`,
    `| Ingestion failures (24h) | ${before.ingestionFailedRuns24h} | ${after.ingestionFailedRuns24h} |`,
    `| Worker heap MB | ${before.workerMemoryHeapUsedMb ?? "—"} | ${after.workerMemoryHeapUsedMb ?? "—"} |`,
    "",
    "## Steps",
    "",
    ...steps.map(
      (s) =>
        `- **${s.name}**: ${s.status}${s.error ? ` — ${s.error}` : ""}${
          s.detail ? ` (${JSON.stringify(s.detail)})` : ""
        }`,
    ),
    "",
    "## Safety",
    "",
    "- Live trading: **OFF** (not modified by maintenance)",
    "- Real money: **OFF**",
    "- Polymarket CLOB execution: **NOT_READY**",
    "",
  ];
  return lines.join("\n");
}

export async function runProductionMaintenance(
  opts: ProductionMaintenanceOptions = {},
): Promise<ProductionMaintenanceResult> {
  const dryRun = opts.dryRun ?? false;
  const source = opts.source ?? MAINTENANCE_SOURCE_PRODUCTION;
  const reportPath = opts.reportPath ?? join(process.cwd(), "PRODUCTION_MAINTENANCE_REPORT.md");

  const before = await collectMaintenanceMetrics();
  const steps: MaintenanceStepResult[] = [];

  const run = await prisma.ingestionRun.create({
    data: {
      source,
      status: "running",
      metadata: { dryRun, before } as object,
    },
  });

  try {
    steps.push({
      name: "orphan_shadow_runs",
      status: dryRun ? "dry_run" : "ok",
      detail: dryRun
        ? { wouldRun: true }
        : {
            shadowCleared: await markOrphanedShadowPortfolioRuns(),
            staleRunningCleared: await markStaleRunningIngestionRuns(),
          },
    });

    steps.push({
      name: "duplicate_shadow_cleanup",
      status: dryRun ? "dry_run" : "ok",
      detail: { ...(await cleanupDuplicateShadows(dryRun)) },
    });

    steps.push({
      name: "shadow_payout_reconcile",
      status: dryRun ? "dry_run" : "ok",
      detail: { ...(await reconcileShadowPayouts(dryRun)) },
    });

    const after = await collectMaintenanceMetrics();
    const body = formatReportMarkdown(before, after, steps, dryRun);
    writeFileSync(reportPath, body, "utf8");

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        metadata: {
          dryRun,
          before,
          after,
          steps,
          reportPath,
          workerMemory: after.workerMemoryHeapUsedMb
            ? {
                heapUsedMb: after.workerMemoryHeapUsedMb,
                highWatermark: after.workerMemoryHigh,
              }
            : undefined,
        } as object,
      },
    });

    return {
      runId: run.id,
      dryRun,
      status: "success",
      before,
      after,
      steps,
      reportWritten: reportPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ name: "maintenance", status: "failed", error: message });
    const after = await collectMaintenanceMetrics().catch(() => before);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: message,
        finishedAt: new Date(),
        metadata: { dryRun, before, after, steps } as object,
      },
    });
    return {
      runId: run.id,
      dryRun,
      status: "failed",
      before,
      after,
      steps,
      reportWritten: null,
      error: message,
    };
  }
}

/** Daily worker subset: repairs + report without external verify scripts. */
export async function runDailyMaintenance(dryRun = false): Promise<ProductionMaintenanceResult> {
  return runProductionMaintenance({
    dryRun,
    source: MAINTENANCE_SOURCE_DAILY,
    skipVerifications: true,
  });
}
