import { prisma } from "./client.js";

export const SNAPSHOT_STALE_MS = Number(
  process.env.WEB_SNAPSHOT_STALE_MS ?? String(10 * 60 * 1000),
);

export interface SnapshotMeta {
  capturedAt: Date;
  refreshMs: number | null;
  error: string | null;
  stale: boolean;
  ageMs: number;
}

export type SnapshotRow<T> = {
  data: T;
  meta: SnapshotMeta;
};

function metaFrom(
  capturedAt: Date,
  refreshMs: number | null,
  error: string | null,
): SnapshotMeta {
  const ageMs = Date.now() - capturedAt.getTime();
  return {
    capturedAt,
    refreshMs,
    error,
    stale: ageMs > SNAPSHOT_STALE_MS,
    ageMs,
  };
}

export async function getDashboardMetricsSnapshot<T = unknown>(): Promise<SnapshotRow<T> | null> {
  const row = await prisma.dashboardMetricsSnapshot.findUnique({ where: { id: "current" } });
  if (!row?.payload) return null;
  return {
    data: row.payload as T,
    meta: metaFrom(row.capturedAt, row.refreshMs, row.error),
  };
}

export async function getCopyTradingSnapshot<T = unknown>(): Promise<SnapshotRow<T> | null> {
  const row = await prisma.copyTradingSnapshot.findUnique({ where: { id: "current" } });
  if (!row?.payload) return null;
  return {
    data: row.payload as T,
    meta: metaFrom(row.capturedAt, row.refreshMs, row.error),
  };
}

export async function getReadinessSnapshot<T = unknown>(): Promise<SnapshotRow<T> | null> {
  const row = await prisma.readinessSnapshot.findUnique({ where: { id: "current" } });
  if (!row?.payload) return null;
  return {
    data: row.payload as T,
    meta: metaFrom(row.capturedAt, row.refreshMs, row.error),
  };
}

export async function getShadowAnalyticsSnapshot<T = unknown>(): Promise<SnapshotRow<T> | null> {
  const row = await prisma.shadowAnalyticsSnapshot.findUnique({ where: { id: "current" } });
  if (!row?.payload) return null;
  return {
    data: row.payload as T,
    meta: metaFrom(row.capturedAt, row.refreshMs, row.error),
  };
}

export async function getWebDiagnosticsSnapshot<T = unknown>(): Promise<SnapshotRow<T> | null> {
  const row = await prisma.webDiagnosticsSnapshot.findUnique({ where: { id: "current" } });
  if (!row?.payload) return null;
  return {
    data: row.payload as T,
    meta: metaFrom(row.capturedAt, null, null),
  };
}

export interface SnapshotAgeSummary {
  dashboard: SnapshotMeta | null;
  copyTrading: SnapshotMeta | null;
  readiness: SnapshotMeta | null;
  shadowAnalytics: SnapshotMeta | null;
  diagnostics: SnapshotMeta | null;
}

export async function getSnapshotAgeSummary(): Promise<SnapshotAgeSummary> {
  const select = { capturedAt: true, refreshMs: true, error: true } as const;
  const map = (
    row: { capturedAt: Date; refreshMs?: number | null; error?: string | null } | null,
  ): SnapshotMeta | null =>
    row ? metaFrom(row.capturedAt, row.refreshMs ?? null, row.error ?? null) : null;

  const [d, c, r, s, w] = await Promise.all([
    prisma.dashboardMetricsSnapshot.findUnique({ where: { id: "current" }, select }),
    prisma.copyTradingSnapshot.findUnique({ where: { id: "current" }, select }),
    prisma.readinessSnapshot.findUnique({ where: { id: "current" }, select }),
    prisma.shadowAnalyticsSnapshot.findUnique({ where: { id: "current" }, select }),
    prisma.webDiagnosticsSnapshot.findUnique({
      where: { id: "current" },
      select: { capturedAt: true },
    }),
  ]);

  return {
    dashboard: map(d),
    copyTrading: map(c),
    readiness: map(r),
    shadowAnalytics: map(s),
    diagnostics: w ? metaFrom(w.capturedAt, null, null) : null,
  };
}
