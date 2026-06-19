import { prisma } from "@augurium/database";
import { isUsOnlyArchitecture } from "@augurium/shared";
import { ingestUsMarketCatalog } from "./ingest-us-market-catalog.js";
import { ingestUsTrades } from "./ingest-us-trades.js";
import { discoverUsWallets } from "./discover-us-wallets.js";
import { runUsWalletScoringJob } from "./run-us-wallet-scoring.js";
import { syncPositionsFromUsData } from "./sync-positions-us.js";
import { runCopyLiveJob } from "./run-copy-live.js";
import { runPortfolioHealthReportJob } from "./run-portfolio-health-report.js";
import { notifyLiveCopyProblem } from "../lib/enqueue-live-copy-discord.js";
import { refreshCopyTraderControls } from "../lib/refresh-copy-trader-controls.js";
import { recordCopyEnabledStreak, recordNoTradeableStreak } from "../lib/copy-funnel-state.js";
import {
  notifyScanComplete,
  notifyFunnelWarning,
  notifyNoEligibleLeaders,
  notifyDbPressureWarning,
} from "../lib/live-copy-ops-discord.js";
import {
  resolvePipelineCycleMode,
  markSlowDiscoveryCompleted,
  slowDiscoveryIntervalMs,
} from "../lib/copy-pipeline-rhythm.js";
import { isDbPressureError } from "../lib/db-pressure.js";

const ENABLED = process.env.COPY_AUTO_PIPELINE_ENABLED === "true";
const PAPER_COPY_ENABLED = process.env.PAPER_COPY_ENABLED === "true";

export interface CopyAutoPipelineSummary {
  enabled: boolean;
  durationMs: number;
  cycleMode?: "fast" | "slow";
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
    if (isDbPressureError(err)) {
      void notifyDbPressureWarning({
        step: name,
        message: err instanceof Error ? err.message : String(err),
      }).catch((e) => console.warn("[discord] db pressure notify failed", e));
    }
    throw err;
  }
}

/** US-only copy pipeline: catalog → trades → wallets → scoring → positions → tiers → live copy. */
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

  const usOnly = isUsOnlyArchitecture();
  const cycleMode = usOnly ? await resolvePipelineCycleMode() : "slow";
  const isSlowCycle = cycleMode === "slow";
  const run = await prisma.ingestionRun.create({
    data: { source: "copy:auto-pipeline", status: "running" },
  });

  console.log(
    `[worker] copy:auto-pipeline started usOnly=${usOnly} cycle=${cycleMode} slowMs=${slowDiscoveryIntervalMs()}`,
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
    if (!usOnly) {
      throw new Error("COPY_AUTO_PIPELINE requires US-only architecture (EXECUTION_PROVIDER=polymarket-us)");
    }

    await pipelineStep("us_market_catalog", ingestUsMarketCatalog);
    tradesIngested = await pipelineStep("us_trade_ingest", ingestUsTrades);
    walletsDiscovered = await pipelineStep("us_wallet_discover", discoverUsWallets);

    const score = await pipelineStep("us_wallet_scoring", runUsWalletScoringJob);
    tradersScored = score.scored;

    positionsSynced = await pipelineStep("us_position_sync", () =>
      syncPositionsFromUsData({ fastOnly: !isSlowCycle }),
    );

    const controls = await pipelineStep("us_leader_controls", () =>
      refreshCopyTraderControls({ mode: cycleMode }),
    );
    console.log(
      `[worker] copy:auto-pipeline copyTraderControl evaluated=${controls.evaluated} enabled=${controls.copyEnabled}`,
    );

    await pipelineStep("rising_wallets", async () => {
      console.log("[worker] copy:auto-pipeline US-only — skip rising_wallets");
      return 0;
    });

    const live = await pipelineStep("live_copy", runCopyLiveJob);
    liveReady = live.ready;
    liveMirrorsBlocked = live.mirrorsBlocked;
    mirrorsSubmitted = live.mirrorsSubmitted;

    await pipelineStep("portfolio_health", runPortfolioHealthReportJob);

    if (usOnly && isSlowCycle) {
      await markSlowDiscoveryCompleted();
    }

    const message = `auto copy: cycle=${cycleMode} usTrades=${tradesIngested} wallets=${walletsDiscovered} scored=${tradersScored} COPY=${controls.copyEnabled} liveReady=${liveReady} liveBlocked=${liveMirrorsBlocked} submitted=${mirrorsSubmitted}`;

    const noTradeReason =
      mirrorsSubmitted === 0
        ? (live as { noTradeReason?: string | null }).noTradeReason ??
          (controls.copyEnabled === 0
            ? `No COPY leaders enabled — dominant blocker: ${controls.topFails[0]?.reason ?? "unknown"}`
            : `No source positions passed US tier entry gates (sourcePositions=${(live as { sourcePositionCount?: number }).sourcePositionCount ?? 0})`)
        : null;

    const funnelStreak = recordCopyEnabledStreak(controls.copyEnabled);
    const sourcePositionCount =
      (live as { sourcePositionCount?: number }).sourcePositionCount ?? 0;
    const noTradeableStreak = recordNoTradeableStreak(controls.copyEnabled, sourcePositionCount);

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        itemCount: tradersScored + paperOpened + mirrorsSubmitted,
        metadata: {
          cycleMode,
          usOnly,
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
          copyEnabled: controls.copyEnabled,
          topFails: controls.topFails,
          leadersByCategory: controls.leadersByCategory,
          sampledWallets: controls.sampledWallets,
          usEvaluated: controls.usEvaluated,
          skippedZeroUsOverlap: controls.skippedZeroUsOverlap,
          bestMatchedMarkets: controls.bestMatchedMarkets,
          sourcePositionCount,
          noTradeReason,
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

    void notifyScanComplete({
      runId: run.id,
      walletsScanned: controls.sampledWallets,
      copyEnabled: controls.copyEnabled,
      leadersByCategory: controls.leadersByCategory,
      submitted: mirrorsSubmitted,
      topFails: controls.topFails,
      sourcePositions: sourcePositionCount,
      noTradeReason,
    }).catch((err) => console.warn("[discord] scan complete notify failed", err));

    if (funnelStreak.shouldWarn) {
      void notifyFunnelWarning({
        streak: funnelStreak.streak,
        topFails: controls.topFails,
        variant: "no-leaders",
        nextAction:
          "US wallet discovery + tier scoring — ensure scan-based us_trade_ingest and us_wallet_scoring are producing candidates.",
      }).catch((err) => console.warn("[discord] funnel warning failed", err));
    }

    if (noTradeableStreak.shouldWarn) {
      void notifyFunnelWarning({
        streak: noTradeableStreak.streak,
        topFails: controls.topFails,
        variant: "no-positions",
        copyEnabled: controls.copyEnabled,
        sourcePositions: sourcePositionCount,
        nextAction:
          "Enabled leaders lack open US positions — verify us_position_sync maps PolymarketScan positions to US catalog slugs.",
      }).catch((err) => console.warn("[discord] no-positions funnel warning failed", err));
    }

    if (controls.copyEnabled === 0) {
      void notifyNoEligibleLeaders({
        copyEnabled: controls.copyEnabled,
        usEvaluated: controls.usEvaluated,
        skippedZeroUsOverlap: controls.skippedZeroUsOverlap,
      }).catch((err) => console.warn("[discord] no-leaders notify failed", err));
    }

    return {
      enabled: true,
      durationMs: Date.now() - started,
      cycleMode,
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
    if (isDbPressureError(err)) {
      void notifyDbPressureWarning({ runId: run.id, message }).catch((e) =>
        console.warn("[discord] db pressure notify failed", e),
      );
    }
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
