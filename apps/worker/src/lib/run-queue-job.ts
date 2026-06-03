import { QUEUES } from "@augurium/shared";
import { ingestPolymarketMarkets } from "../jobs/ingest-markets.js";
import { ingestGlobalTrades } from "../jobs/ingest-trades.js";
import { linkTradesToMarkets } from "../jobs/link-trades.js";
import { discoverWalletsFromHolders } from "../jobs/discover-wallets.js";
import { ingestWalletActivity } from "../jobs/ingest-wallet-activity.js";
import { syncPositionsFromApi } from "../jobs/sync-positions.js";
import { reconstructPositionsFromTrades } from "../jobs/reconstruct-positions.js";
import { runScoreTradersJob } from "../jobs/score-traders.js";
import { runGenerateSignalsJob } from "../jobs/generate-signals.js";
import { runShadowPortfolioJob } from "../jobs/run-shadow-portfolio.js";
import { runDiscordEnqueueJob } from "../jobs/discord-enqueue.js";
import { runDiscordDispatchJob } from "../jobs/discord-dispatch.js";
import { runPortfolioEngineJob } from "../jobs/run-portfolio-engine.js";
import { runExecutionEngineJob } from "../jobs/run-execution-engine.js";
import { runMaintenanceDailyJob } from "../jobs/run-maintenance-daily.js";
import { processDiscordNotifications } from "../engines/discord.js";

export type JobCounts = Record<string, string | number | boolean>;

export async function runQueueJob(queue: string): Promise<JobCounts> {
  switch (queue) {
    case QUEUES.MARKET_INGEST: {
      const synced = await ingestPolymarketMarkets();
      return { synced };
    }
    case QUEUES.TRADE_INGEST: {
      const ingested = await ingestGlobalTrades();
      return { ingested };
    }
    case QUEUES.TRADE_LINK: {
      const linked = await linkTradesToMarkets();
      return { linked };
    }
    case QUEUES.WALLET_DISCOVER: {
      const discovered = await discoverWalletsFromHolders();
      return { discovered };
    }
    case QUEUES.WALLET_ACTIVITY: {
      const activity = await ingestWalletActivity();
      return { activity };
    }
    case QUEUES.POSITION_SYNC: {
      const synced = await syncPositionsFromApi();
      return { synced };
    }
    case QUEUES.POSITION_RECONSTRUCT: {
      const reconstructed = await reconstructPositionsFromTrades();
      return { reconstructed };
    }
    case QUEUES.TRADER_SCORE: {
      const s = await runScoreTradersJob();
      return {
        scored: s.scored,
        skipped: s.skipped,
        remaining: s.remaining,
        durationMs: s.durationMs,
      };
    }
    case QUEUES.SIGNAL_GENERATE: {
      const s = await runGenerateSignalsJob();
      return { generated: s.generated, expired: s.expired };
    }
    case QUEUES.SHADOW_SYNC: {
      const s = await runShadowPortfolioJob();
      return {
        selectedCount: s.selectedCount,
        processedCount: s.processedCount,
        updatedCount: s.updatedCount,
        freshCount: s.freshCount,
        staleCount: s.staleCount,
        shadowTotal: s.shadowTotal,
        timedOut: s.timedOut,
        partialTimeout: s.partialTimeout,
        unchangedSkipped: s.unchangedSkipped,
        durationMs: s.durationMs,
        created: s.created,
      };
    }
    case QUEUES.DISCORD_ENQUEUE: {
      const s = await runDiscordEnqueueJob();
      return { queued: s.queued, skipped: s.skipped };
    }
    case QUEUES.DISCORD_DISPATCH: {
      const s = await runDiscordDispatchJob();
      return { sent: s.sent, failed: s.failed, skipped: s.skipped, retried: s.retried };
    }
    case QUEUES.DISCORD_NOTIFY: {
      const n = await processDiscordNotifications();
      return { processed: n };
    }
    case QUEUES.PORTFOLIO_RUN: {
      const s = await runPortfolioEngineJob();
      return {
        decisions: s.decisions,
        accepted: s.accepted,
        positionsOpened: s.positionsOpened,
        positionsClosed: s.positionsClosed,
      };
    }
    case QUEUES.EXECUTION_RUN: {
      const s = await runExecutionEngineJob();
      return {
        mode: s.mode,
        placed: s.placed,
        blocked: s.blocked,
        eligible: s.eligible,
      };
    }
    case QUEUES.MAINTENANCE_DAILY: {
      const s = await runMaintenanceDailyJob();
      return {
        status: String(s.status ?? "unknown"),
        categoriesUpdated: Number(s.categoriesUpdated ?? 0),
        liveTradingReady: Boolean(s.liveTradingReady),
      };
    }
    default:
      return { skipped: true, reason: "unknown-queue" };
  }
}
