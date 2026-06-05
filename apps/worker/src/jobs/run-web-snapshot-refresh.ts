import {
  buildDashboardSnapshotPayload,
  getCopyTradingSnapshot,
  getReadinessSnapshot,
  refreshCoreWebSnapshots,
  upsertCopyTradingSnapshot,
  upsertDashboardSnapshot,
  upsertWebDiagnostics,
  type LiveTradingReadinessReport,
  type WebDiagnosticsPayload,
  type WebSnapshotRefreshStep,
} from "@augurium/database";
import {
  computeAcceptanceForensics,
  computeCopyBoard,
  computeCopyTradingReadiness,
} from "@augurium/copy-trading";

export interface WebSnapshotRefreshSummary {
  steps: WebSnapshotRefreshStep[];
  totalMs: number;
  message: string;
}

export async function runWebSnapshotRefreshJob(): Promise<WebSnapshotRefreshSummary> {
  const started = Date.now();
  const core = await refreshCoreWebSnapshots();
  const steps: WebSnapshotRefreshStep[] = [...core.steps];

  const copyStarted = Date.now();
  try {
    const board = await computeCopyBoard(60);
    const acceptance = await computeAcceptanceForensics();
    const copyReadiness = await computeCopyTradingReadiness();
    await upsertCopyTradingSnapshot(
      { board, acceptance, copyReadiness, generatedAt: new Date().toISOString() },
      Date.now() - copyStarted,
    );
    steps.push({ name: "copy_trading", ok: true, durationMs: Date.now() - copyStarted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await upsertCopyTradingSnapshot({ error: message }, Date.now() - copyStarted, message);
    steps.push({
      name: "copy_trading",
      ok: false,
      durationMs: Date.now() - copyStarted,
      error: message,
    });
  }

  const dashStarted = Date.now();
  try {
    const readinessRow = await getReadinessSnapshot<LiveTradingReadinessReport>();
    const copyRow = await getCopyTradingSnapshot<{
      board?: Awaited<ReturnType<typeof computeCopyBoard>>;
      acceptance?: Awaited<ReturnType<typeof computeAcceptanceForensics>>;
      copyReadiness?: Awaited<ReturnType<typeof computeCopyTradingReadiness>>;
    }>();
    const warnings: string[] = [];
    if (readinessRow?.meta.stale) warnings.push("Readiness snapshot stale");
    if (copyRow?.meta.stale) warnings.push("Copy trading snapshot stale");

    const payload = {
      ...(await buildDashboardSnapshotPayload(readinessRow?.data ?? null, warnings)),
      board: copyRow?.data?.board ?? null,
      acceptance: copyRow?.data?.acceptance ?? null,
      copyReadiness: copyRow?.data?.copyReadiness ?? null,
      copyMeta: copyRow?.meta ?? null,
      readinessMeta: readinessRow?.meta ?? null,
    };
    await upsertDashboardSnapshot(payload, Date.now() - dashStarted);
    steps.push({ name: "dashboard", ok: true, durationMs: Date.now() - dashStarted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({
      name: "dashboard",
      ok: false,
      durationMs: Date.now() - dashStarted,
      error: message,
    });
  }

  const mem = process.memoryUsage();
  const diagnostics: WebDiagnosticsPayload = {
    ...core.diagnostics,
    refreshedAt: new Date().toISOString(),
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    steps,
  };
  await upsertWebDiagnostics(diagnostics);

  const failed = steps.filter((s) => !s.ok);
  return {
    steps,
    totalMs: Date.now() - started,
    message:
      failed.length === 0
        ? "web snapshots refreshed"
        : `web snapshots partial: ${failed.map((f) => f.name).join(", ")} failed`,
  };
}
