import { prisma } from "@augurium/database";

import { ingestGlobalTrades } from "./ingest-trades.js";

import { discoverWalletsFromHolders } from "./discover-wallets.js";

import {

  ingestWalletActivityForCopyTargets,

} from "./ingest-wallet-activity.js";

import { runScoreTradersJob } from "./score-traders.js";

import { syncPositionsFromApi } from "./sync-positions.js";
import { syncPositionsForCopyTargetsFirst } from "./sync-positions-copy-priority.js";
import { detectRisingWallets } from "@augurium/copy-trading";

import { runCopyPaperJob } from "./run-copy-paper.js";

import { runCopyLiveJob } from "./run-copy-live.js";



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

  message: string;

}



/**

 * One tick (~9 min): scan Polymarket → refresh COPY wallets → rescore → sync → paper + live prep.

 */

export async function runCopyAutoPipelineJob(): Promise<CopyAutoPipelineSummary> {

  const started = Date.now();



  if (!ENABLED) {

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

      message: "COPY_AUTO_PIPELINE_ENABLED is not true — auto copy idle",

    };

  }



  const run = await prisma.ingestionRun.create({

    data: { source: "copy:auto-pipeline", status: "running" },

  });



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



  try {

    tradesIngested = await ingestGlobalTrades();

    walletsDiscovered = await discoverWalletsFromHolders();

    if (INCLUDE_WALLET_ACTIVITY) {

      walletActivityIngested = await ingestWalletActivityForCopyTargets();

    }

    const score = await runScoreTradersJob();

    tradersScored = score.scored;

    await detectRisingWallets(10);
    const copySync = await syncPositionsForCopyTargetsFirst();
    positionsSynced = copySync + (await syncPositionsFromApi());

    const paper = await runCopyPaperJob();

    paperCopyEnabled = paper.copyEnabled;

    paperOpened = paper.opened;

    paperClosed = paper.closed;

    const live = await runCopyLiveJob();

    liveReady = live.ready;

    liveMirrorsBlocked = live.mirrorsBlocked;



    const message = `auto copy: trades=${tradesIngested} walletAct=${walletActivityIngested} scored=${tradersScored} COPY=${paperCopyEnabled} paper+${paperOpened}/-${paperClosed} liveReady=${liveReady}`;

    await prisma.ingestionRun.update({

      where: { id: run.id },

      data: {

        status: "completed",

        finishedAt: new Date(),

        itemCount: tradersScored + paperOpened,

        metadata: {

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

        } as object,

      },

    });



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

      message,

    };

  } catch (err) {

    const message = err instanceof Error ? err.message : String(err);

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

