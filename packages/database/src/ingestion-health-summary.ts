import { prisma } from "./client.js";

export interface IngestionHealthSummary {
  failedRuns24h: number;
  failedRuns7d: number;
  staleRunningRuns: number;
  paginationResets24h: number;
  cursorStreams: Array<{
    stream: string;
    cursorValue: string;
    status: string;
    lastError: string | null;
    resetReason: string | null;
  }>;
  recentFailures: Array<{
    source: string;
    error: string | null;
    startedAt: Date;
  }>;
  healthy: boolean;
  notes: string[];
  generatedAt: string;
}

export async function computeIngestionHealthSummary(): Promise<IngestionHealthSummary> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const [failedRuns24h, failedRuns7d, staleRunningRuns, cursors, recentFailures] =
    await Promise.all([
      prisma.ingestionRun.count({
        where: {
          status: { in: ["failed", "error"] },
          startedAt: { gte: since24h },
        },
      }),
      prisma.ingestionRun.count({
        where: {
          status: { in: ["failed", "error"] },
          startedAt: { gte: since7d },
        },
      }),
      prisma.ingestionRun.count({
        where: { status: "running", startedAt: { lt: staleCutoff } },
      }),
      prisma.syncCursor.findMany({
        orderBy: { stream: "asc" },
        take: 50,
      }),
      prisma.ingestionRun.findMany({
        where: { status: "failed", startedAt: { gte: since7d } },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: { source: true, error: true, startedAt: true },
      }),
    ]);

  let paginationResets24h = 0;
  const cursorStreams = cursors.map((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const resetReason =
      typeof meta.resetReason === "string" ? meta.resetReason : null;
    if (resetReason === "pagination-offset-exhausted" && c.lastRunAt && c.lastRunAt >= since24h) {
      paginationResets24h++;
    }
    return {
      stream: c.stream,
      cursorValue: c.cursorValue,
      status: c.status,
      lastError: c.error,
      resetReason,
    };
  });

  const notes: string[] = [];
  if (failedRuns24h > 0) {
    notes.push(
      `${failedRuns24h} ingestion run(s) failed in the last 24h (historical; new pagination exhaustion resets do not increment this)`,
    );
  }
  if (staleRunningRuns > 0) {
    notes.push(`${staleRunningRuns} run(s) stuck in running >30m`);
  }
  if (paginationResets24h > 0) {
    notes.push(
      `${paginationResets24h} cursor reset(s) from pagination exhaustion (expected at feed end)`,
    );
  }

  const healthy = failedRuns24h === 0 && staleRunningRuns === 0;

  return {
    failedRuns24h,
    failedRuns7d,
    staleRunningRuns,
    paginationResets24h,
    cursorStreams,
    recentFailures,
    healthy,
    notes,
    generatedAt: new Date().toISOString(),
  };
}
