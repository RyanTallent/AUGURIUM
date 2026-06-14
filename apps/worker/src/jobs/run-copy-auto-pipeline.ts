import { prisma } from "@augurium/database";
import { detectRisingWallets } from "@augurium/copy-trading";
import { isUsOnlyLiveCopyMode, isUsBroadIntelMode, usePolymarketScanIntel } from "@augurium/shared";
import { ingestGlobalTrades } from "./ingest-trades.js";
import { discoverWalletsFromHolders } from "./discover-wallets.js";
import { ingestWalletActivityForCopyTargets } from "./ingest-wallet-activity.js";
import { ingestPolymarketScanLeaders } from "./ingest-polymarket-scan.js";
import { ingestUsMarketCatalog } from "./ingest-us-market-catalog.js";
import { runScoreTradersJob } from "./score-traders.js";
import { syncPositionsFromApi } from "./sync-positions.js";
import { syncPositionsForCopyTargetsFirst } from "./sync-positions-copy-priority.js";
import { syncPositionsFromPolymarketScan } from "./sync-positions-polymarket-scan.js";
import { runCopyPaperJob } from "./run-copy-paper.js";
import { runCopyLiveJob } from "./run-copy-live.js";
import { runPortfolioHealthReportJob } from "./run-portfolio-health-report.js";
import { notifyLiveCopyProblem } from "../lib/enqueue-live-copy-discord.js";
import { refreshCopyTraderControls } from "../lib/refresh-copy-trader-controls.js";

const ENABLED = process.env.COPY_AUTO_PIPELINE_ENABLED === "true";
const INCLUDE_WALLET_ACTIVITY =
  process.env.COPY_AUTO_INCLUDE_WALLET_ACTIVITY !== "false";
const PAPER_COPY_ENABLED = process.env.PAPER_COPY_ENABLED === "true";

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
  return process.env.LIVE_COPY_ENABLED === "true" && !PAPER_COPY_ENABLED;
}

const INCLUDE_WALLET_DISCOVER = process.env.COPY_AUTO_INCLUDE_WALLET_DISCOVER === "true";
const INCLUDE_GENERAL_POSITION_SYNC =
  process.env.COPY_AUTO_SYNC_GENERAL_POSITIONS !== "false";

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

/** Every ~3 min (configurable): PolymarketScan → score COPY wallets → sync → verified live buy/sell. */
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

  const scanIntel = usePolymarketScanIntel();
  const usMode = scanIntel || isUsOnlyLiveCopyMode();
  const broadIntel = usMode && isUsBroadIntelMode();
  const lite = useLiteLivePath() && !broadIntel;
  const run = await prisma.ingestionRun.create({
    data: { source: "copy:auto-pipeline", status: "running" },
  });

  console.log(
    `[worker] copy:auto-pipeline started mode=${lite ? "lite-live" : "full"} usOnly=${usMode} broadIntel=${broadIntel}`,
  );

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
    if (usMode) {
      walletsDiscovered = await pipelineStep("polymarket_scan_leaders", ingestPolymarketScanLeaders);
      await pipelineStep("us_market_catalog", ingestUsMarketCatalog);
      if (broadIntel) {
        if (INCLUDE_WALLET_DISCOVER) {
          walletsDiscovered += await pipelineStep("wallet_discover", discoverWalletsFromHolders);
        }
        if (INCLUDE_WALLET_ACTIVITY) {
          walletActivityIngested = await pipelineStep(
            "wallet_activity",
            ingestWalletActivityForCopyTargets,
          );
        }
      } else {
        console.log("[worker] copy:auto-pipeline US mode — skip global trade ingest and wallet discover");
      }
    } else if (!lite) {
      tradesIngested = await pipelineStep("trade_ingest", ingestGlobalTrades);
      walletsDiscovered = await pipelineStep("wallet_discover", discoverWalletsFromHolders);
    } else {
      console.log(
        "[worker] copy:auto-pipeline lite-live — skip global trade ingest (trade:ingest queue handles it)",
      );
      if (INCLUDE_WALLET_DISCOVER) {
        walletsDiscovered = await pipelineStep("wallet_discover", discoverWalletsFromHolders);
      }
    }

    if (!usMode && INCLUDE_WALLET_ACTIVITY) {
      walletActivityIngested = await pipelineStep(
        "wallet_activity",
        ingestWalletActivityForCopyTargets,
      );
    }

    if (!usMode || broadIntel) {
      const score = await pipelineStep("score_traders", runScoreTradersJob);
      tradersScored = score.scored;
    } else {
      console.log("[worker] copy:auto-pipeline US mode — trader scores from PolymarketScan ingest");
    }

    const controls = await pipelineStep("copy_trader_controls", refreshCopyTraderControls);
    console.log(
      `[worker] copy:auto-pipeline copyTraderControl evaluated=${controls.evaluated} enabled=${controls.copyEnabled}`,
    );

    await pipelineStep("rising_wallets", async () => {
      if (usMode && !broadIntel) {
        console.log("[worker] copy:auto-pipeline US mode — skip rising_wallets");
        return 0;
      }
      const hits = await detectRisingWallets(Number(process.env.COPY_RISING_WALLET_LIMIT ?? "25"));
      return hits.length;
    });

    if (usMode && !broadIntel) {
      positionsSynced = await pipelineStep("position_sync_scan", syncPositionsFromPolymarketScan);
    } else if (usMode && broadIntel) {
      positionsSynced = await pipelineStep("position_sync_scan", syncPositionsFromPolymarketScan);
      positionsSynced += await pipelineStep(
        "position_sync_copy",
        syncPositionsForCopyTargetsFirst,
      );
    } else if (lite) {
      positionsSynced = await pipelineStep(
        "position_sync_copy",
        syncPositionsForCopyTargetsFirst,
      );
      if (INCLUDE_GENERAL_POSITION_SYNC) {
        positionsSynced += await pipelineStep("position_sync", syncPositionsFromApi);
      }
    } else {
      positionsSynced = await pipelineStep("position_sync", async () => {
        const copySync = await syncPositionsForCopyTargetsFirst();
        return copySync + (await syncPositionsFromApi());
      });
    }

    if (PAPER_COPY_ENABLED) {
      const paper = await pipelineStep("paper_copy", runCopyPaperJob);
      paperCopyEnabled = paper.copyEnabled;
      paperOpened = paper.opened;
      paperClosed = paper.closed;
    }

    const live = await pipelineStep("live_copy", runCopyLiveJob);
    liveReady = live.ready;
    liveMirrorsBlocked = live.mirrorsBlocked;
    mirrorsSubmitted = live.mirrorsSubmitted;

    await pipelineStep("portfolio_health", runPortfolioHealthReportJob);

    const message = `auto copy: trades=${tradesIngested} scanWallets=${walletsDiscovered} walletAct=${walletActivityIngested} scored=${tradersScored} COPY=${controls.copyEnabled} liveReady=${liveReady} liveBlocked=${liveMirrorsBlocked} submitted=${mirrorsSubmitted}`;

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        itemCount: tradersScored + paperOpened + mirrorsSubmitted,
        metadata: {
          usMode,
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
          bankrollUsd: live.bankrollUsd,
          availableUsd: live.availableUsd,
          deployedUsd: live.deployedUsd,
          tradeSizeUsd: live.tradeSizeUsd,
          bankrollSource: live.bankrollSource,
          usOpenPositions: live.usOpenPositions,
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
