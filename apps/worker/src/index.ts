import { Redis } from "ioredis";
import { prisma } from "@augurium/database";
import {
  formatScheduleSummary,
  getQueueIntervalMs,
  isQueueDue,
  jobNameForQueue,
  PERIODIC_ANALYSIS_QUEUES,
  WORKER_QUEUES,
} from "./lib/queue-scheduler.js";
import { QUEUES, isUsBroadIntelMode, getUsCompatMinConfidence } from "@augurium/shared";
import { runQueueJob } from "./lib/run-queue-job.js";
import {
  markOrphanedCopyAutoPipelineRuns,
  markOrphanedShadowPortfolioRuns,
} from "./lib/ingestion-run-lifecycle.js";
import {
  logJobMemory,
  shouldSkipQueueForMemory,
} from "./lib/worker-memory.js";
import { logPolymarketStartupCheck } from "./lib/polymarket-startup-check.js";
import { ensureLiveCopyDiscordOnStartup } from "./lib/enqueue-live-copy-discord.js";
import { runPortfolioHealthReportJob } from "./jobs/run-portfolio-health-report.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "30000");

const redis = new Redis(REDIS_URL);
const lastRunAtMs = new Map<string, number>();
const COPY_PIPELINE_ENABLED = process.env.COPY_AUTO_PIPELINE_ENABLED === "true";
let copyPipelineRunning = false;

async function drainRedisTriggers(): Promise<void> {
  for (const queue of WORKER_QUEUES) {
    let drained = 0;
    while (await redis.lpop(queue)) {
      drained++;
    }
    if (drained > 0) {
      console.log(`[worker] drained ${drained} redis trigger(s) from queue=${queue}`);
    }
  }
}

async function hasRedisTrigger(queue: string): Promise<boolean> {
  const len = await redis.llen(queue);
  if (len > 0) {
    await redis.lpop(queue);
    return true;
  }
  return false;
}

async function executeQueue(queue: string, reason: "interval" | "redis"): Promise<void> {
  const job = jobNameForQueue(queue);
  if (shouldSkipQueueForMemory(queue)) {
    console.warn(`[worker] skipping noncritical job=${job} queue=${queue} (heap high)`);
    lastRunAtMs.set(queue, Date.now());
    return;
  }
  const started = Date.now();
  console.log(`[worker] job start job=${job} queue=${queue} reason=${reason}`);
  try {
    const counts = await runQueueJob(queue);
    logJobMemory(job, queue);
    console.log(
      `[worker] job done job=${job} queue=${queue} reason=${reason} durationMs=${Date.now() - started}`,
      counts,
    );
  } catch (err) {
    logJobMemory(job, queue);
    console.error(
      `[worker] job failed job=${job} queue=${queue} reason=${reason} durationMs=${Date.now() - started}`,
      err,
    );
  } finally {
    lastRunAtMs.set(queue, Date.now());
  }
}

async function tick(): Promise<void> {
  if (copyPipelineRunning) {
    return;
  }
  for (const queue of WORKER_QUEUES) {
    if (COPY_PIPELINE_ENABLED && queue === QUEUES.COPY_AUTO_PIPELINE) {
      continue;
    }
    const triggered = await hasRedisTrigger(queue);
    const due = triggered || isQueueDue(queue, lastRunAtMs.get(queue));
    if (!due) continue;
    await executeQueue(queue, triggered ? "redis" : "interval");
  }
}

async function runCopyAutoPipeline(reason: "interval" | "redis"): Promise<void> {
  if (copyPipelineRunning) {
    console.log(`[worker] copy:auto-pipeline already running — skip (${reason})`);
    return;
  }
  copyPipelineRunning = true;
  try {
    await executeQueue(QUEUES.COPY_AUTO_PIPELINE, reason);
  } finally {
    copyPipelineRunning = false;
  }
}

function scheduleCopyAutoPipeline(): void {
  const intervalMs = getQueueIntervalMs(QUEUES.COPY_AUTO_PIPELINE);
  setInterval(() => {
    void runCopyAutoPipeline("interval").catch((err) =>
      console.error("[worker] copy:auto-pipeline interval error", err),
    );
  }, intervalMs);
  console.log(
    `[worker] copy:auto-pipeline on dedicated timer every ${Math.round(intervalMs / 1000)}s`,
  );
}

async function bootstrap(): Promise<void> {
  console.log("[worker] AUGURIUM worker starting (Phase A–G)");
  console.log("[worker] redis:", REDIS_URL);
  console.log("[worker] poll interval ms:", POLL_INTERVAL_MS);
  console.log("[worker] periodic analysis schedule:", formatScheduleSummary());

  for (const queue of PERIODIC_ANALYSIS_QUEUES) {
    console.log(
      `[worker] scheduled job=${jobNameForQueue(queue)} queue=${queue} intervalMs=${getQueueIntervalMs(queue)}`,
    );
  }

  await redis.ping();
  console.log("[worker] redis connected");
  console.log(
    `[worker] copy auto pipeline: ${process.env.COPY_AUTO_PIPELINE_ENABLED === "true" ? "ENABLED" : "DISABLED"}`,
  );
  if (process.env.COPY_AUTO_PIPELINE_ENABLED === "true") {
    console.log(
      `[worker] copy auto pipeline interval ms: ${getQueueIntervalMs(QUEUES.COPY_AUTO_PIPELINE)}`,
    );
    console.log(
      `[worker] US broad intel: ${isUsBroadIntelMode()} (COPY_US_BROAD_INTEL=${process.env.COPY_US_BROAD_INTEL ?? "default"}) minConf=${getUsCompatMinConfidence()} globalSlug=${process.env.US_COMPAT_TRY_GLOBAL_SLUG ?? "default"}`,
    );
  }

  const [orphanedShadow, orphanedCopy] = await Promise.all([
    markOrphanedShadowPortfolioRuns(),
    markOrphanedCopyAutoPipelineRuns(),
  ]);
  if (orphanedShadow > 0) {
    console.log(`[worker] cleared ${orphanedShadow} orphaned shadow-portfolio ingestion run(s)`);
  }
  if (orphanedCopy > 0) {
    console.log(`[worker] cleared ${orphanedCopy} orphaned copy:auto-pipeline ingestion run(s)`);
  }

  await drainRedisTriggers();
  await logPolymarketStartupCheck();
  await ensureLiveCopyDiscordOnStartup();

  if (COPY_PIPELINE_ENABLED) {
    console.log("[worker] running copy:auto-pipeline first (live trading priority)");
    await runCopyAutoPipeline("interval");
    scheduleCopyAutoPipeline();
  }

  if (!copyPipelineRunning) {
    lastRunAtMs.set(QUEUES.WEB_SNAPSHOT_REFRESH, Date.now());
    console.log("[worker] refreshing web snapshots in background (dashboard)");
    void executeQueue(QUEUES.WEB_SNAPSHOT_REFRESH, "interval").catch((err) =>
      console.error("[worker] web:snapshot-refresh background error", err),
    );
  }

  setInterval(() => {
    void tick().catch((err) => console.error("[worker] tick error", err));
  }, POLL_INTERVAL_MS);

  const healthIntervalMs = Number(process.env.WORKER_INTERVAL_PORTFOLIO_HEALTH_MS ?? "86400000");
  setInterval(() => {
    void runPortfolioHealthReportJob().catch((err) =>
      console.error("[worker] portfolio health report error", err),
    );
  }, healthIntervalMs);
  console.log(
    `[worker] portfolio health report every ${Math.round(healthIntervalMs / 3600000)}h`,
  );

  await tick();
}

bootstrap().catch(async (err) => {
  console.error("[worker] fatal", err);
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
