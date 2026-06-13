import { prisma } from "@augurium/database";
import { detectRisingWallets } from "@augurium/copy-trading";
import { ingestGlobalTrades } from "./ingest-trades.js";
import { discoverWalletsFromHolders } from "./discover-wallets.js";
import { ingestWalletActivityForCopyTargets } from "./ingest-wallet-activity.js";
import { runScoreTradersJob } from "./score-traders.js";
import { syncPositionsFromApi } from "./sync-positions.js";
import { syncPositionsForCopyTargetsFirst } from "./sync-positions-copy-priority.js";
import { runCopyPaperJob } from "./run-copy-paper.js";
import { runCopyLiveJob } from "./run-copy-live.js";
import { notifyLiveCopyProblem } from "../lib/enqueue-live-copy-discord.js";

const ENABLED = process.env.COPY_AUTO_PIPELINE_ENABLED === "true";
const INCLUDE_WALLET_ACTIVITY =
  process.env.COPY_AUTO_INCLUDE_WALLET_ACTIVITY !== "false";

export interface CopyAutoPipelineSummary {
  enabled: boolean;
  durationMs: number;
  tradesIngested: number;
  walletsDiscovered: number;
  walletActivityIngested: number;
  tradersScored: number;
  positionsSynced: number;
  paperCopyEnabled: number;
  paperOpened: number;
  paperClosed: number;
  liveReady: boolean;
  liveMirrorsBlocked: number;
  mirrorsSubmitted: number;
  message: string;
}

function useLiteLivePath(): boolean {
  if (process.env.COPY_AUTO_SKIP_HEAVY_INGEST === "false") return false;
  return (
    process.env.LIVE_COPY_ENABLED === "true" && process.env.PAPER_COPY_ENABLED !== "true"
  );
}

async function pipelineStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`[worker] copy:auto-pipeline step ${name} start`);
  try {
    const result = await fn();
    console.log(
      `[worker] copy:auto-pipeline step ${name} done ms=${Date.now() - started}`,
    );
    return result;
  } catch (err) {
    console.error(
      `[worker] copy:auto-pipeline step ${name} failed ms=${Date.now() - started}`,
      err,
    );
    throw err;
  }
}

/** Every ~5 min: scan → score COPY wallets → sync → verified live buy/sell. */
export async function runCopyAutoPipelineJob(): Promise<CopyAutoPipelineSummary> {
  const started = Date.now();

  if (!ENABLED) {
    console.warn("[worker] copy:auto-pipeline disabled — set COPY_AUTO_PIPELINE_ENABLED=true");
    return {
      enabled: false,
      durationMs: 0,
      tradesIngested: 0,
      walletsDiscovered: 0,
      walletActivityIngested: 0,
      tradersScored: 0,
      positionsSynced: 0,
      paperCopyEnabled: 0,
      paperOpened: 0,
      paperClosed: 0,
      liveReady: false,
      liveMirrorsBlocked: 0,
      mirrorsSubmitted: 0,
      message: "COPY_AUTO_PIPELINE_ENABLED is not true — auto copy idle",
    };
  }

  const lite = useLiteLivePath();
  const run = await prisma.ingestionRun.create({
    data: { source: "copy:auto-pipeline", status: "running" },
  });

  console.log(`[worker] copy:auto-pipeline started mode=${lite ? "lite-live" : "full"}`);

  let tradesIngested = 0;
  let walletsDiscovered = 0;
  let walletActivityIngested = 0;
  let tradersScored = 0;
  let positionsSynced = 0;
  let paperCopyEnabled = 0;
  let paperOpened = 0;
  let paperClosed = 0;
  let liveReady = false;
  let liveMirrorsBlocked = 0;
  let mirrorsSubmitted = 0;

  try {
    if (!lite) {
      tradesIngested = await pipelineStep("trade_ingest", ingestGlobalTrades);
      walletsDiscovered = await pipelineStep("wallet_discover", discoverWalletsFromHolders);
    } else {
      console.log(
        "[worker] copy:auto-pipeline lite-live — skip global trade ingest (trade:ingest queue handles it)",
      );
    }

    if (INCLUDE_WALLET_ACTIVITY) {
      walletActivityIngested = await pipelineStep(
        "wallet_activity",
        ingestWalletActivityForCopyTargets,
      );
    }

    const score = await pipelineStep("score_traders", runScoreTradersJob);
    tradersScored = score.scored;

    await pipelineStep("rising_wallets", () => detectRisingWallets(10));

    if (lite) {
      positionsSynced = await pipelineStep(
        "position_sync_copy",
        syncPositionsForCopyTargetsFirst,
      );
    } else {
      positionsSynced = await pipelineStep("position_sync", async () => {
        const copySync = await syncPositionsForCopyTargetsFirst();
        return copySync + (await syncPositionsFromApi());
      });
    }

    const paper = await pipelineStep("paper_copy", runCopyPaperJob);
    paperCopyEnabled = paper.copyEnabled;
    paperOpened = paper.opened;
    paperClosed = paper.closed;

    const live = await pipelineStep("live_copy", runCopyLiveJob);
    liveReady = live.ready;
    liveMirrorsBlocked = live.mirrorsBlocked;
    mirrorsSubmitted = live.mirrorsSubmitted;

    const message = `auto copy: trades=${tradesIngested} walletAct=${walletActivityIngested} scored=${tradersScored} COPY=${paperCopyEnabled} liveReady=${liveReady} liveBlocked=${liveMirrorsBlocked} submitted=${mirrorsSubmitted}`;

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        itemCount: tradersScored + paperOpened + mirrorsSubmitted,
        metadata: {
          lite,
          tradesIngested,
          walletsDiscovered,
          walletActivityIngested,
          tradersScored,
          positionsSynced,
          paperCopyEnabled,
          paperOpened,
          paperClosed,
          liveReady,
          liveMirrorsBlocked,
          mirrorsSubmitted,
        } as object,
      },
    });

    console.log(`[worker] copy:auto-pipeline finished ${message}`);

    return {
      enabled: true,
      durationMs: Date.now() - started,
      tradesIngested,
      walletsDiscovered,
      walletActivityIngested,
      tradersScored,
      positionsSynced,
      paperCopyEnabled,
      paperOpened,
      paperClosed,
      liveReady,
      liveMirrorsBlocked,
      mirrorsSubmitted,
      message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notifyLiveCopyProblem({
      key: `pipeline:${run.id}`,
      message: `copy:auto-pipeline failed: ${message}`,
    });
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: message,
      },
    });
    throw err;
  }
}
