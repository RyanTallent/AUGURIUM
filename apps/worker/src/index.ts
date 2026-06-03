import Redis from "ioredis";
import { prisma } from "@augurium/database";
import { QUEUES } from "@augurium/shared";
import { ingestPolymarketMarkets } from "./jobs/ingest-markets.js";
import { scoreTraders } from "./engines/scoring.js";
import { generateSignals } from "./engines/signals.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const POLL_INTERVAL_MS = 30_000;

const redis = new Redis(REDIS_URL);

async function processQueue(queue: string): Promise<void> {
  const payload = await redis.lpop(queue);
  if (!payload) return;

  console.log(`[worker] processing ${queue}:`, payload);

  switch (queue) {
    case QUEUES.MARKET_INGEST:
      await ingestPolymarketMarkets();
      break;
    case QUEUES.TRADER_SCORE:
      await scoreTraders();
      break;
    case QUEUES.SIGNAL_GENERATE:
      await generateSignals();
      break;
    default:
      console.warn(`[worker] unknown queue: ${queue}`);
  }
}

async function tick(): Promise<void> {
  for (const queue of Object.values(QUEUES)) {
    if (queue === QUEUES.DISCORD_NOTIFY) continue;
    await processQueue(queue);
  }
}

async function bootstrap(): Promise<void> {
  console.log("[worker] AUGURIUM worker starting…");
  console.log("[worker] redis:", REDIS_URL);

  await redis.ping();
  console.log("[worker] redis connected");

  // Seed initial ingestion on startup
  await redis.rpush(QUEUES.MARKET_INGEST, "bootstrap");
  await redis.rpush(QUEUES.TRADER_SCORE, "bootstrap");
  await redis.rpush(QUEUES.SIGNAL_GENERATE, "bootstrap");

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
