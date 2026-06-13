import {
  computeLiveTradingReadiness,
  computeShadowAnalytics,
  getCopyTradingSnapshot,
  getDashboardMetricsSnapshot,
  getReadinessSnapshot,
  getShadowAnalyticsSnapshot,
  getSnapshotAgeSummary,
  getWebDiagnosticsSnapshot,
  type DashboardSnapshotPayload,
  type LiveTradingReadinessReport,
  type ProductionHealthReport,
  type SnapshotMeta,
  type WebDiagnosticsPayload,
} from "@augurium/database";
import {
  computeAcceptanceForensics,
  computeCopyBoard,
  computeCopyTradingReadiness,
  type CopyBoardReport,
  type CopyTradingReadinessReport,
} from "@augurium/copy-trading";
import { runWithWebDbGuard, webMemorySnapshot } from "./web-db-guard";

export type PageLoadSource = "snapshot" | "live" | "unavailable";

export interface PageLoadMeta {
  source: PageLoadSource;
  snapshot?: SnapshotMeta;
  error?: string;
  stale?: boolean;
}

export interface HomePageData {
  board: CopyBoardReport | null;
  readiness: CopyTradingReadinessReport | null;
  acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>> | null;
  warnings: string[];
}

export async function loadHomePageData(): Promise<{ data: HomePageData; meta: PageLoadMeta }> {
  const dash = await getDashboardMetricsSnapshot<
    HomePageData & { copyReadiness?: CopyTradingReadinessReport }
  >();
  if (dash?.data.board) {
    return {
      data: {
        board: dash.data.board,
        readiness: dash.data.copyReadiness ?? null,
        acceptance: dash.data.acceptance ?? null,
        warnings: dash.data.warnings ?? [],
      },
      meta: { source: "snapshot", snapshot: dash.meta, stale: dash.meta.stale },
    };
  }

  const copySnap = await getCopyTradingSnapshot<{
    board: CopyBoardReport;
    acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>>;
    copyReadiness?: CopyTradingReadinessReport;
  }>();
  if (copySnap?.data.board) {
    return {
      data: {
        board: copySnap.data.board,
        readiness: copySnap.data.copyReadiness ?? null,
        acceptance: copySnap.data.acceptance,
        warnings: copySnap.meta.stale ? ["Showing last cached copy board"] : [],
      },
      meta: { source: "snapshot", snapshot: copySnap.meta, stale: copySnap.meta.stale },
    };
  }

  const live = await runWithWebDbGuard("home-live", async () => {
    const board = await computeCopyBoard(40);
    const readiness = await computeCopyTradingReadiness();
    const acceptance = await computeAcceptanceForensics();
    return {
      board,
      readiness,
      acceptance,
      warnings: ["Live fallback — enable worker web:snapshot-refresh"],
    };
  });

  if (live.data) {
    return { data: live.data, meta: { source: "live", error: live.error ?? undefined } };
  }

  return {
    data: { board: null, readiness: null, acceptance: null, warnings: [] },
    meta: {
      source: "unavailable",
      error: live.error ?? "Data not ready. Worker must run web:snapshot-refresh.",
      stale: true,
    },
  };
}

export async function loadReadinessPageData(): Promise<{
  report: LiveTradingReadinessReport | null;
  meta: PageLoadMeta;
}> {
  const snap = await getReadinessSnapshot<LiveTradingReadinessReport>();
  if (snap && !snap.meta.stale) {
    return { report: snap.data, meta: { source: "snapshot", snapshot: snap.meta } };
  }
  const live = await runWithWebDbGuard("readiness-live", () => computeLiveTradingReadiness());
  if (live.data) {
    return {
      report: live.data,
      meta: { source: "live", stale: snap?.meta.stale, error: live.error ?? undefined },
    };
  }
  return {
    report: snap?.data ?? null,
    meta: { source: "unavailable", stale: true, error: live.error ?? undefined },
  };
}

export async function loadCopyBoardPageData(): Promise<{
  board: CopyBoardReport | null;
  readiness: CopyTradingReadinessReport | null;
  mirrorAnalytics: import("@augurium/copy-trading").CopyMirrorAnalytics | null;
  weeklyRisk: import("@augurium/copy-trading").CopyWeeklyRiskStatus | null;
  meta: PageLoadMeta;
}> {
  const snap = await getCopyTradingSnapshot<{
    board: CopyBoardReport;
    copyReadiness?: CopyTradingReadinessReport;
    mirrorAnalytics?: import("@augurium/copy-trading").CopyMirrorAnalytics;
    weeklyRisk?: import("@augurium/copy-trading").CopyWeeklyRiskStatus;
  }>();
  if (snap?.data?.board) {
    return {
      board: snap.data.board,
      readiness: snap.data.copyReadiness ?? null,
      mirrorAnalytics: snap.data.mirrorAnalytics ?? null,
      weeklyRisk: snap.data.weeklyRisk ?? null,
      meta: { source: "snapshot", snapshot: snap.meta, stale: snap.meta.stale },
    };
  }
  const live = await runWithWebDbGuard("copy-page-live", async () => {
    const { computeCopyMirrorAnalytics, evaluateCopyWeeklyStopLoss } = await import(
      "@augurium/copy-trading"
    );
    const board = await computeCopyBoard(60);
    const readiness = await computeCopyTradingReadiness();
    const mirrorAnalytics = await computeCopyMirrorAnalytics();
    const weeklyRisk = await evaluateCopyWeeklyStopLoss();
    return { board, readiness, mirrorAnalytics, weeklyRisk };
  });
  if (live.data) {
    return { ...live.data, meta: { source: "live", stale: snap?.meta.stale } };
  }
  return {
    board: snap?.data?.board ?? null,
    readiness: snap?.data?.copyReadiness ?? null,
    mirrorAnalytics: snap?.data?.mirrorAnalytics ?? null,
    weeklyRisk: null,
    meta: { source: "unavailable", error: live.error ?? undefined, stale: true },
  };
}

export async function loadCopyPortfoliosData(): Promise<{
  board: CopyBoardReport | null;
  acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>> | null;
  meta: PageLoadMeta;
}> {
  const snap = await getCopyTradingSnapshot<{
    board: CopyBoardReport;
    acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>>;
  }>();
  if (snap?.data?.board) {
    return {
      board: snap.data.board,
      acceptance: snap.data.acceptance,
      meta: { source: "snapshot", snapshot: snap.meta, stale: snap.meta.stale },
    };
  }
  const live = await runWithWebDbGuard("copy-portfolios-live", async () => {
    const board = await computeCopyBoard(60);
    const acceptance = await computeAcceptanceForensics();
    return { board, acceptance };
  });
  if (live.data) {
    return { ...live.data, meta: { source: "live" } };
  }
  return {
    board: snap?.data?.board ?? null,
    acceptance: snap?.data?.acceptance ?? null,
    meta: { source: "unavailable", error: live.error ?? undefined, stale: true },
  };
}

export async function loadShadowAnalyticsPageData(): Promise<{
  report: Awaited<ReturnType<typeof computeShadowAnalytics>> | null;
  meta: PageLoadMeta;
}> {
  const snap = await getShadowAnalyticsSnapshot<
    Awaited<ReturnType<typeof computeShadowAnalytics>>
  >();
  if (snap && !snap.meta.stale) {
    return { report: snap.data, meta: { source: "snapshot", snapshot: snap.meta } };
  }
  const live = await runWithWebDbGuard("shadow-analytics-live", () => computeShadowAnalytics());
  if (live.data) {
    return { report: live.data, meta: { source: "live", stale: snap?.meta.stale } };
  }
  return {
    report: snap?.data ?? null,
    meta: { source: "unavailable", error: live.error ?? undefined, stale: true },
  };
}

export async function loadMaintenancePageData(): Promise<{
  readiness: LiveTradingReadinessReport | null;
  health: ProductionHealthReport | null;
  readinessMeta: PageLoadMeta;
  healthMeta: PageLoadMeta;
}> {
  const dash = await getDashboardMetricsSnapshot<DashboardSnapshotPayload & Record<string, unknown>>();
  const readinessSnap = await getReadinessSnapshot<LiveTradingReadinessReport>();

  if (readinessSnap && !readinessSnap.meta.stale) {
    return {
      readiness: readinessSnap.data,
      health: dash?.data?.productionHealth ?? null,
      readinessMeta: { source: "snapshot", snapshot: readinessSnap.meta },
      healthMeta: dash
        ? { source: "snapshot", snapshot: dash.meta }
        : { source: "unavailable", stale: true },
    };
  }

  const live = await runWithWebDbGuard("maintenance-live", async () => {
    const readiness = await computeLiveTradingReadiness();
    return { readiness, health: dash?.data?.productionHealth ?? null };
  });

  return {
    readiness: live.data?.readiness ?? readinessSnap?.data ?? null,
    health: live.data?.health ?? dash?.data?.productionHealth ?? null,
    readinessMeta: live.data
      ? { source: "live" }
      : { source: "unavailable", error: live.error ?? undefined, stale: true },
    healthMeta: { source: dash ? "snapshot" : "unavailable", stale: !dash },
  };
}

export async function loadMaintenanceDiagnostics(): Promise<{
  diagnostics: WebDiagnosticsPayload | null;
  snapshotAges: Awaited<ReturnType<typeof getSnapshotAgeSummary>>;
  webMemory: ReturnType<typeof webMemorySnapshot>;
}> {
  const [diag, ages] = await Promise.all([
    getWebDiagnosticsSnapshot<WebDiagnosticsPayload>(),
    getSnapshotAgeSummary(),
  ]);
  return {
    diagnostics: diag?.data ?? null,
    snapshotAges: ages,
    webMemory: webMemorySnapshot(),
  };
}
