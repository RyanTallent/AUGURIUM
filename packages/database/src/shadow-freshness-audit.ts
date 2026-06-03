import { prisma } from "./client.js";

export interface ShadowFreshnessAudit {
  shadowTotal: number;
  byStatus: Record<string, number>;
  fresh: number;
  stale: number;
  noSource: number;
  noUpdate: number;
  other: number;
  freshPct: number;
  stalePct: number;
  noSourcePct: number;
  noUpdatePct: number;
  sumMatchesTotal: boolean;
  latestSyncFresh: number | null;
  latestSyncStale: number | null;
  generatedAt: string;
}

export async function auditShadowFreshness(): Promise<ShadowFreshnessAudit> {
  const [shadowTotal, grouped, latestRun] = await Promise.all([
    prisma.shadowTrade.count(),
    prisma.shadowTrade.groupBy({ by: ["priceStatus"], _count: true }),
    prisma.ingestionRun.findFirst({
      where: { source: "shadow-portfolio", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { metadata: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    grouped.map((g) => [g.priceStatus ?? "unknown", g._count]),
  );

  const fresh = byStatus.FRESH ?? 0;
  const stale = byStatus.STALE ?? 0;
  const noSource = byStatus.NO_PRICE_SOURCE ?? 0;
  const noUpdate = byStatus.NO_PRICE_UPDATE ?? 0;
  const counted = fresh + stale + noSource + noUpdate;
  const other = Math.max(0, shadowTotal - counted);

  const meta =
    latestRun?.metadata && typeof latestRun.metadata === "object"
      ? (latestRun.metadata as Record<string, unknown>)
      : null;

  return {
    shadowTotal,
    byStatus,
    fresh,
    stale,
    noSource,
    noUpdate,
    other,
    freshPct: shadowTotal ? (fresh / shadowTotal) * 100 : 0,
    stalePct: shadowTotal ? (stale / shadowTotal) * 100 : 0,
    noSourcePct: shadowTotal ? (noSource / shadowTotal) * 100 : 0,
    noUpdatePct: shadowTotal ? (noUpdate / shadowTotal) * 100 : 0,
    sumMatchesTotal: counted + other === shadowTotal,
    latestSyncFresh: typeof meta?.fresh === "number" ? meta.fresh : null,
    latestSyncStale: typeof meta?.stale === "number" ? meta.stale : null,
    generatedAt: new Date().toISOString(),
  };
}
