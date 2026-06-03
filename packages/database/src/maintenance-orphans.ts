import { prisma } from "./client.js";

const SHADOW_SOURCE = "shadow-portfolio";

/** Mark long-running shadow-portfolio ingestion runs as failed (worker restart safe). */
export async function markOrphanedShadowPortfolioRuns(
  olderThanMs = Number(process.env.SHADOW_SYNC_ORPHAN_MS ?? String(10 * 60 * 1000)),
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await prisma.ingestionRun.findMany({
    where: {
      source: SHADOW_SOURCE,
      status: "running",
      startedAt: { lt: cutoff },
    },
    select: { id: true, startedAt: true },
  });

  if (orphans.length === 0) return 0;

  const now = new Date();
  for (const run of orphans) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed_orphaned",
        finishedAt: now,
        error: `orphaned: running since ${run.startedAt.toISOString()}`,
        metadata: {
          reason: "maintenance_orphan_cleanup",
          orphanedAt: now.toISOString(),
        },
      },
    });
  }

  return orphans.length;
}

/** Any ingestion run stuck in running beyond threshold. */
export async function markStaleRunningIngestionRuns(
  olderThanMs = Number(process.env.INGESTION_ORPHAN_MS ?? String(30 * 60 * 1000)),
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await prisma.ingestionRun.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    select: { id: true, source: true },
  });

  const now = new Date();
  for (const run of orphans) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed_orphaned",
        finishedAt: now,
        error: "orphaned: maintenance stale running cleanup",
        metadata: { reason: "maintenance_stale_running", source: run.source },
      },
    });
  }

  return orphans.length;
}
