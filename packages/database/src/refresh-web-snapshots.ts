import { prisma } from "./client.js";
import { computeLiveTradingReadiness, type LiveTradingReadinessReport } from "./readiness-report.js";
import { computeShadowAnalytics, type ShadowAnalyticsReport } from "./shadow-analytics.js";
import { getProductionHealthReport, type ProductionHealthReport } from "./production-health.js";
import { getSnapshotAgeSummary, type SnapshotAgeSummary } from "./web-snapshots.js";

export interface WebSnapshotRefreshStep {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface WebSnapshotRefreshResult {
  steps: WebSnapshotRefreshStep[];
  totalMs: number;
  diagnostics: WebDiagnosticsPayload;
}

export interface WebDiagnosticsPayload {
  refreshedAt: string;
  heapUsedMb: number | null;
  heapTotalMb: number | null;
  rssMb: number | null;
  snapshotAges: SnapshotAgeSummary;
  steps: WebSnapshotRefreshStep[];
  webPrismaConnectionLimit: string;
  snapshotStaleMs: number;
  notes: string[];
}

async function upsertReadiness(payload: LiveTradingReadinessReport, refreshMs: number, error?: string) {
  await prisma.readinessSnapshot.upsert({
    where: { id: "current" },
    create: { id: "current", payload: payload as object, refreshMs, error, capturedAt: new Date() },
    update: { payload: payload as object, refreshMs, error, capturedAt: new Date() },
  });
}

async function upsertShadow(payload: ShadowAnalyticsReport, refreshMs: number, error?: string) {
  await prisma.shadowAnalyticsSnapshot.upsert({
    where: { id: "current" },
    create: { id: "current", payload: payload as object, refreshMs, error, capturedAt: new Date() },
    update: { payload: payload as object, refreshMs, error, capturedAt: new Date() },
  });
}

export async function upsertDashboardSnapshot(
  payload: unknown,
  refreshMs: number,
  error?: string,
): Promise<void> {
  await prisma.dashboardMetricsSnapshot.upsert({
    where: { id: "current" },
    create: { id: "current", payload: payload as object, refreshMs, error, capturedAt: new Date() },
    update: { payload: payload as object, refreshMs, error, capturedAt: new Date() },
  });
}

export async function upsertCopyTradingSnapshot(
  payload: unknown,
  refreshMs: number,
  error?: string,
): Promise<void> {
  await prisma.copyTradingSnapshot.upsert({
    where: { id: "current" },
    create: { id: "current", payload: payload as object, refreshMs, error, capturedAt: new Date() },
    update: { payload: payload as object, refreshMs, error, capturedAt: new Date() },
  });
}

export async function upsertWebDiagnostics(payload: WebDiagnosticsPayload): Promise<void> {
  await prisma.webDiagnosticsSnapshot.upsert({
    where: { id: "current" },
    create: { id: "current", payload: payload as object, capturedAt: new Date() },
    update: { payload: payload as object, capturedAt: new Date() },
  });
}

async function runStep(
  name: string,
  fn: () => Promise<void>,
): Promise<WebSnapshotRefreshStep> {
  const started = Date.now();
  try {
    await fn();
    return { name, ok: true, durationMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, durationMs: Date.now() - started, error: message };
  }
}

/** Sequential refresh — never parallel heavy analytics (worker only). */
export async function refreshCoreWebSnapshots(): Promise<WebSnapshotRefreshResult> {
  const steps: WebSnapshotRefreshStep[] = [];
  const totalStarted = Date.now();

  steps.push(
    await runStep("readiness", async () => {
      const t0 = Date.now();
      const report = await computeLiveTradingReadiness();
      await upsertReadiness(report, Date.now() - t0);
    }),
  );

  steps.push(
    await runStep("shadow_analytics", async () => {
      const t0 = Date.now();
      const report = await computeShadowAnalytics();
      await upsertShadow(report, Date.now() - t0);
    }),
  );

  const mem = process.memoryUsage();
  const snapshotAges = await getSnapshotAgeSummary();
  const diagnostics: WebDiagnosticsPayload = {
    refreshedAt: new Date().toISOString(),
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    snapshotAges,
    steps,
    webPrismaConnectionLimit: process.env.WEB_PRISMA_CONNECTION_LIMIT ?? "3",
    snapshotStaleMs: Number(process.env.WEB_SNAPSHOT_STALE_MS ?? String(10 * 60 * 1000)),
    notes: [
      "Snapshots refreshed by worker — web should read these first.",
      "Render web Starter: keep WEB_PRISMA_CONNECTION_LIMIT<=3.",
      "Optional: schedule daily web restart off-peak if memory drifts (not a substitute for snapshots).",
    ],
  };

  await upsertWebDiagnostics(diagnostics);

  return {
    steps,
    totalMs: Date.now() - totalStarted,
    diagnostics,
  };
}

export interface DashboardSnapshotPayload {
  warnings: string[];
  productionHealth: ProductionHealthReport | null;
  readinessScore: number | null;
  liveTradingReady: boolean;
  paperProgressLabel: string | null;
  generatedAt: string;
}

export async function buildDashboardSnapshotPayload(
  readiness: LiveTradingReadinessReport | null,
  warnings: string[],
): Promise<DashboardSnapshotPayload> {
  let health: ProductionHealthReport | null = null;
  try {
    health = await getProductionHealthReport();
  } catch {
    health = null;
  }
  return {
    warnings,
    productionHealth: health,
    readinessScore: readiness?.overallScore ?? null,
    liveTradingReady: readiness?.liveTradingReady ?? false,
    paperProgressLabel: readiness?.paperProgressLabel ?? null,
    generatedAt: new Date().toISOString(),
  };
}
