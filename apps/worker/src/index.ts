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
import { runQueueJob } from "./lib/run-queue-job.js";
import { markOrphanedShadowPortfolioRuns } from "./lib/ingestion-run-lifecycle.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "30000");

const redis = new Redis(REDIS_URL);
const lastRunAtMs = new Map<string, number>();

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
  const started = Date.now();
  console.log(`[worker] job start job=${job} queue=${queue} reason=${reason}`);
  try {
    const counts = await runQueueJob(queue);
    console.log(
      `[worker] job done job=${job} queue=${queue} reason=${reason} durationMs=${Date.now() - started}`,
      counts,
    );
  } catch (err) {
    console.error(
      `[worker] job failed job=${job} queue=${queue} reason=${reason} durationMs=${Date.now() - started}`,
      err,
    );
  } finally {
    lastRunAtMs.set(queue, Date.now());
  }
}

async function tick(): Promise<void> {
  for (const queue of WORKER_QUEUES) {
    const triggered = await hasRedisTrigger(queue);
    const due = triggered || isQueueDue(queue, lastRunAtMs.get(queue));
    if (!due) continue;
    await executeQueue(queue, triggered ? "redis" : "interval");
  }
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

  const orphaned = await markOrphanedShadowPortfolioRuns();
  if (orphaned > 0) {
    console.log(`[worker] cleared ${orphaned} orphaned shadow-portfolio ingestion run(s)`);
  }

  await drainRedisTriggers();

  setInterval(() => {
    void tick().catch((err) => console.error("[worker] tick error", err));
  }, POLL_INTERVAL_MS);

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
