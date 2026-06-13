import { prisma } from "@augurium/database";

const SHADOW_SOURCE = "shadow-portfolio";
const COPY_PIPELINE_SOURCE = "copy:auto-pipeline";

export async function markOrphanedCopyAutoPipelineRuns(
  olderThanMs = Number(process.env.COPY_PIPELINE_ORPHAN_MS ?? String(20 * 60 * 1000)),
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await prisma.ingestionRun.findMany({
    where: {
      source: COPY_PIPELINE_SOURCE,
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
          reason: "worker_restarted_or_job_hung",
          orphanedAt: now.toISOString(),
        },
      },
    });
  }

  console.log(
    `[worker] marked ${orphans.length} orphaned copy:auto-pipeline run(s) as failed_orphaned`,
  );
  return orphans.length;
}

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
          reason: "worker_restarted_or_job_hung",
          orphanedAt: now.toISOString(),
        },
      },
    });
  }

  console.log(`[shadow:sync] marked ${orphans.length} orphaned shadow-portfolio run(s) as failed_orphaned`);
  return orphans.length;
}

export async function writeShadowSyncProgress(
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      metadata: payload as object,
      itemCount: typeof payload.processed === "number" ? payload.processed : undefined,
    },
  });
}

export async function finalizeShadowPortfolioRun(
  runId: string,
  outcome: {
    status: "success" | "error" | "failed_orphaned";
    itemCount: number;
    metadata: Record<string, unknown>;
    error?: string;
  },
): Promise<void> {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: outcome.status,
      itemCount: outcome.itemCount,
      metadata: outcome.metadata as object,
      error: outcome.error ?? null,
      finishedAt: new Date(),
    },
  });
}

export async function ensureShadowRunNotStuck(runId: string): Promise<void> {
  const run = await prisma.ingestionRun.findUnique({
    where: { id: runId },
    select: { status: true, finishedAt: true },
  });
  if (run?.status === "running" && run.finishedAt == null) {
    await finalizeShadowPortfolioRun(runId, {
      status: "error",
      itemCount: 0,
      metadata: { reason: "unexpected_exit_before_finalize" },
      error: "shadow sync exited without final status",
    });
  }
}
