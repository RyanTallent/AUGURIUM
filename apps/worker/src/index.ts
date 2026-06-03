import { Redis } from "ioredis";
import { prisma } from "@augurium/database";
import { QUEUES, WORKER_QUEUES } from "@augurium/shared";
import { ingestPolymarketMarkets } from "./jobs/ingest-markets.js";
import { ingestGlobalTrades } from "./jobs/ingest-trades.js";
import { linkTradesToMarkets } from "./jobs/link-trades.js";
import { discoverWalletsFromHolders } from "./jobs/discover-wallets.js";
import { ingestWalletActivity } from "./jobs/ingest-wallet-activity.js";
import { syncPositionsFromApi } from "./jobs/sync-positions.js";
import { reconstructPositionsFromTrades } from "./jobs/reconstruct-positions.js";
import { scoreTraders } from "./engines/scoring.js";
import { generateSignals } from "./engines/signals.js";
import { syncShadowPortfolio } from "./engines/shadow.js";
import { dispatchDiscordEvents, processDiscordNotifications } from "./engines/discord.js";
import { runPortfolioEngine } from "./engines/portfolio.js";
import { runExecutionEngine } from "./engines/execution.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "30000");

const redis = new Redis(REDIS_URL);

async function processQueue(queue: string): Promise<void> {
  const payload = await redis.lpop(queue);
  if (!payload) return;

  console.log(`[worker] processing ${queue}:`, payload);

  switch (queue) {
    case QUEUES.MARKET_INGEST:
      await ingestPolymarketMarkets();
      break;
    case QUEUES.TRADE_INGEST:
      await ingestGlobalTrades();
      break;
    case QUEUES.TRADE_LINK:
      await linkTradesToMarkets();
      break;
    case QUEUES.WALLET_DISCOVER:
      await discoverWalletsFromHolders();
      break;
    case QUEUES.WALLET_ACTIVITY:
      await ingestWalletActivity();
      break;
    case QUEUES.POSITION_SYNC:
      await syncPositionsFromApi();
      break;
    case QUEUES.POSITION_RECONSTRUCT:
      await reconstructPositionsFromTrades();
      break;
    case QUEUES.TRADER_SCORE:
      await scoreTraders();
      break;
    case QUEUES.SIGNAL_GENERATE:
      await generateSignals();
      break;
    case QUEUES.SHADOW_SYNC:
      await syncShadowPortfolio();
      break;
    case QUEUES.DISCORD_ENQUEUE: {
      const { runDiscordEnqueueJob } = await import("./jobs/discord-enqueue.js");
      await runDiscordEnqueueJob();
      break;
    }
    case QUEUES.DISCORD_DISPATCH:
      await dispatchDiscordEvents();
      break;
    case QUEUES.DISCORD_NOTIFY:
      await processDiscordNotifications();
      break;
    case QUEUES.PORTFOLIO_RUN:
      await runPortfolioEngine();
      break;
    case QUEUES.EXECUTION_RUN:
      await runExecutionEngine();
      break;
    default:
      console.warn(`[worker] unknown queue: ${queue}`);
  }
}

async function tick(): Promise<void> {
  for (const queue of WORKER_QUEUES) {
    await processQueue(queue);
  }
}

async function bootstrap(): Promise<void> {
  console.log("[worker] AUGURIUM worker starting (Phase A–G)");
  console.log("[worker] redis:", REDIS_URL);

  await redis.ping();
  console.log("[worker] redis connected");

  for (const queue of WORKER_QUEUES) {
    await redis.rpush(queue, "bootstrap");
  }

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
