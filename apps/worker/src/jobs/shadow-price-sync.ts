import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  applyAuguriumExitRules,
  computePositionMetrics,
  resolveShadowPrice,
  shadowEntryMs,
  updateExcursions,
} from "@augurium/shadow";
import { buildBatchPriceContext, bestMarketLatestTrade } from "../lib/shadow-batch-context.js";
import {
  finalizeShadowPortfolioRun,
  writeShadowSyncProgress,
} from "../lib/ingestion-run-lifecycle.js";
import { priceCheckReasonForResult } from "../lib/shadow-price-sources.js";
import {
  basePriceFieldsUnchanged,
  openPositionFieldsUnchanged,
  type ShadowRowUpdate,
} from "../lib/shadow-sync-update.js";
import {
  resolveShadowSyncBatchSize,
  selectShadowSyncBatch,
} from "../lib/shadow-sync-batch.js";

const SHADOW_STALE_AFTER_MS = Number(
  process.env.SHADOW_PRICE_STALE_MS ?? String(6 * 60 * 60 * 1000),
);
const SHADOW_SYNC_MAX_RUNTIME_MS = Number(
  process.env.SHADOW_SYNC_MAX_RUNTIME_MS ?? "180000",
);
const SHADOW_SYNC_CHUNK_SIZE = Number(process.env.SHADOW_SYNC_CHUNK_SIZE ?? "25");
const UPDATE_CONCURRENCY = Number(process.env.SHADOW_SYNC_UPDATE_CONCURRENCY ?? "12");

export class ShadowSyncTimeoutError extends Error {
  constructor(message = "shadow sync max runtime exceeded") {
    super(message);
    this.name = "ShadowSyncTimeoutError";
  }
}

export interface ShadowPriceSyncStats {
  shadowTotal: number;
  selectedCount: number;
  processedCount: number;
  updatedCount: number;
  unchangedSkipped: number;
  closedCount: number;
  freshCount: number;
  staleCount: number;
  noSourceCount: number;
  noUpdateCount: number;
  errorCount: number;
  batchSize: number;
  chunkSize: number;
  chunkCount: number;
  durationMs: number;
  timedOut: boolean;
  partialTimeout: boolean;
}

function tallyStatus(
  status: string,
  counts: Pick<ShadowPriceSyncStats, "freshCount" | "staleCount" | "noSourceCount" | "noUpdateCount">,
): void {
  if (status === "FRESH") counts.freshCount++;
  else if (status === "STALE") counts.staleCount++;
  else if (status === "NO_PRICE_SOURCE") counts.noSourceCount++;
  else if (status === "NO_PRICE_UPDATE") counts.noUpdateCount++;
}

function progressPayload(stats: ShadowPriceSyncStats, extra: Record<string, unknown> = {}) {
  return {
    shadowTotal: stats.shadowTotal,
    selected: stats.selectedCount,
    processed: stats.processedCount,
    updated: stats.updatedCount,
    unchangedSkipped: stats.unchangedSkipped,
    fresh: stats.freshCount,
    stale: stats.staleCount,
    noSource: stats.noSourceCount,
    noUpdate: stats.noUpdateCount,
    closed: stats.closedCount,
    errors: stats.errorCount,
    batchSize: stats.batchSize,
    chunkSize: stats.chunkSize,
    timedOut: stats.timedOut,
    partialTimeout: stats.partialTimeout,
    ...extra,
  };
}

type ShadowWithSignal = Awaited<ReturnType<typeof loadShadowChunk>>[number];

async function loadShadowChunk(ids: string[]) {
  return prisma.shadowTrade.findMany({
    where: { id: { in: ids } },
    include: { signal: { include: { market: true } } },
  });
}

async function flushShadowUpdates(updates: ShadowRowUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const limit = Math.max(1, UPDATE_CONCURRENCY);
  for (let i = 0; i < updates.length; i += limit) {
    const slice = updates.slice(i, i + limit);
    await Promise.all(
      slice.map((u) => prisma.shadowTrade.update({ where: { id: u.id }, data: u.data })),
    );
  }
}

function buildRowUpdate(
  shadow: ShadowWithSignal,
  priced: ReturnType<typeof resolveShadowPrice>,
  checkReason: string,
  now: Date,
): { update: ShadowRowUpdate | null; closed: boolean } {
  const baseUpdate = {
    currentPrice: priced.currentPrice,
    priceStatus: priced.priceStatus,
    priceSource: priced.priceSource,
    lastPriceUpdateAt: priced.lastPriceUpdateAt ?? shadow.lastPriceUpdateAt,
    priceCheckedAt: now,
    priceCheckReason: checkReason,
  };

  if (shadow.status !== "OPEN") {
    return { update: null, closed: false };
  }

  let state = computePositionMetrics(
    shadow.simulatedEntryPrice,
    priced.currentPrice,
    shadow.simulatedSizeUsd,
    shadow.positionRemaining,
    shadow.realizedPnl,
    shadow.side,
  );
  state = {
    ...state,
    partialExitDone: shadow.partialExitDone,
    runnerActive: shadow.runnerActive,
    maxFavorableExcursion: shadow.maxFavorableExcursion,
    maxAdverseExcursion: shadow.maxAdverseExcursion,
  };
  state = updateExcursions(state, state.roi);

  const signal = shadow.signal;
  const { state: nextState, decision } = applyAuguriumExitRules(
    state,
    {
      currentPrice: priced.currentPrice,
      outcomeSide: shadow.side,
      signalExpired: signal.expiresAt ? signal.expiresAt < now : false,
      signalInactive: signal.status !== "active",
      marketClosed: signal.market.closed || signal.market.resolved,
      marketResolved: signal.market.resolved,
      consensusCollapsed: signal.status !== "active" || signal.consensusScore < 40,
    },
    shadow.entryReasoning,
  );

  const nextStatus = decision?.status ?? shadow.status;
  const nextReasoning = decision?.latestReasoning ?? shadow.latestReasoning;

  if (
    basePriceFieldsUnchanged(shadow, priced) &&
    openPositionFieldsUnchanged(shadow, {
      positionRemaining: nextState.positionRemaining,
      unrealizedPnl: nextState.unrealizedPnl,
      realizedPnl: nextState.realizedPnl,
      roi: nextState.roi,
      maxFavorableExcursion: nextState.maxFavorableExcursion,
      maxAdverseExcursion: nextState.maxAdverseExcursion,
      partialExitDone: nextState.partialExitDone,
      runnerActive: nextState.runnerActive,
      latestReasoning: nextReasoning,
      status: nextStatus,
    }) &&
    !decision
  ) {
    return { update: null, closed: false };
  }

  const data: Prisma.ShadowTradeUpdateInput = {
    ...baseUpdate,
    positionRemaining: nextState.positionRemaining,
    unrealizedPnl: nextState.unrealizedPnl,
    realizedPnl: nextState.realizedPnl,
    roi: nextState.roi,
    maxFavorableExcursion: nextState.maxFavorableExcursion,
    maxAdverseExcursion: nextState.maxAdverseExcursion,
    partialExitDone: nextState.partialExitDone,
    runnerActive: nextState.runnerActive,
    latestReasoning: nextReasoning,
    ...(decision
      ? {
          status: decision.status,
          closedAt: now,
          closeReason: decision.closeReason,
          payoutFormula: decision.payoutFormula ?? "mark_to_market",
          payoutDiagnostic: null,
          invalidForAnalytics: false,
          missedProfitAfterExit: decision.missedProfitAfterExit,
          wouldHaveBeenBetterToHold: decision.wouldHaveBeenBetterToHold,
        }
      : {}),
  };

  return { update: { id: shadow.id, data }, closed: Boolean(decision) };
}

async function finalizeTimeoutRun(
  runId: string,
  stats: ShadowPriceSyncStats,
  err: ShadowSyncTimeoutError,
): Promise<void> {
  stats.partialTimeout = stats.processedCount > 0;
  const status = stats.partialTimeout ? "success" : "error";
  await finalizeShadowPortfolioRun(runId, {
    status,
    itemCount: stats.processedCount,
    error: stats.partialTimeout ? undefined : err.message,
    metadata: {
      ...progressPayload(stats),
      timedOut: true,
      partial: stats.partialTimeout,
      reason: "max_runtime_exceeded",
      maxRuntimeMs: SHADOW_SYNC_MAX_RUNTIME_MS,
      durationMs: stats.durationMs,
    },
  });
}

/** Reprice up to SHADOW_SYNC_BATCH_SIZE shadow trades with chunking, timeout, and progress writes. */
export async function runShadowPriceSync(
  now = new Date(),
  runId?: string,
): Promise<ShadowPriceSyncStats> {
  const startedAt = Date.now();
  const deadline = startedAt + SHADOW_SYNC_MAX_RUNTIME_MS;
  const batchSize = resolveShadowSyncBatchSize();
  const chunkSize = Math.max(1, SHADOW_SYNC_CHUNK_SIZE);

  const stats: ShadowPriceSyncStats = {
    shadowTotal: 0,
    selectedCount: 0,
    processedCount: 0,
    updatedCount: 0,
    unchangedSkipped: 0,
    closedCount: 0,
    freshCount: 0,
    staleCount: 0,
    noSourceCount: 0,
    noUpdateCount: 0,
    errorCount: 0,
    batchSize,
    chunkSize,
    chunkCount: 0,
    durationMs: 0,
    timedOut: false,
    partialTimeout: false,
  };

  const candidates = await prisma.shadowTrade.findMany({
    select: {
      id: true,
      status: true,
      priceStatus: true,
      lastPriceUpdateAt: true,
      priceCheckedAt: true,
    },
  });
  stats.shadowTotal = candidates.length;

  const syncBatch = selectShadowSyncBatch(candidates, batchSize);
  stats.selectedCount = syncBatch.length;
  stats.chunkCount = Math.ceil(syncBatch.length / chunkSize) || 0;

  console.log(
    `[shadow:sync] start shadowTotal=${stats.shadowTotal} selected=${stats.selectedCount} batchSize=${batchSize} chunkSize=${chunkSize} chunks=${stats.chunkCount} maxRuntimeMs=${SHADOW_SYNC_MAX_RUNTIME_MS}`,
  );

  if (runId) {
    await writeShadowSyncProgress(runId, {
      phase: "sync_started",
      ...progressPayload(stats),
      durationMs: 0,
    });
  }

  try {
    for (let chunkIndex = 0; chunkIndex < stats.chunkCount; chunkIndex++) {
      if (Date.now() >= deadline) {
        stats.timedOut = true;
        throw new ShadowSyncTimeoutError();
      }

      const slice = syncBatch.slice(
        chunkIndex * chunkSize,
        chunkIndex * chunkSize + chunkSize,
      );
      const ids = slice.map((s) => s.id);
      const chunkRows = await loadShadowChunk(ids);
      const ctx = await buildBatchPriceContext(chunkRows);
      const pendingUpdates: ShadowRowUpdate[] = [];

      for (const shadow of chunkRows) {
        if (Date.now() >= deadline) {
          stats.timedOut = true;
          throw new ShadowSyncTimeoutError();
        }
        stats.processedCount++;
        try {
          const sources = ctx.sourcesFor(shadow);
          const bestTrade = bestMarketLatestTrade(sources);
          const entryMs = shadowEntryMs(shadow.signal.createdAt, shadow.entryDelayMs);
          const priced = resolveShadowPrice({
            entryMs,
            entryPrice: shadow.simulatedEntryPrice,
            side: shadow.side,
            tape: sources.tape,
            marketLatestTrade: bestTrade,
            marketSnapshotPrice: sources.marketSnapshotPrice,
            lastKnownPrice: shadow.currentPrice,
            now,
            staleAfterMs: SHADOW_STALE_AFTER_MS,
          });
          tallyStatus(priced.priceStatus, stats);
          const checkReason = priceCheckReasonForResult(
            priced,
            bestTrade?.reason ?? null,
            SHADOW_STALE_AFTER_MS,
            now,
          );
          const { update, closed } = buildRowUpdate(shadow, priced, checkReason, now);
          if (update) {
            pendingUpdates.push(update);
          } else {
            stats.unchangedSkipped++;
          }
          if (closed) stats.closedCount++;
        } catch (err) {
          stats.errorCount++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[shadow:sync] error shadowId=${shadow.id}`, message);
        }
      }

      await flushShadowUpdates(pendingUpdates);
      stats.updatedCount += pendingUpdates.length;

      const durationMs = Date.now() - startedAt;
      console.log(
        `[shadow:sync] chunk=${chunkIndex + 1}/${stats.chunkCount} processed=${stats.processedCount} updated=${stats.updatedCount} skipped=${stats.unchangedSkipped} fresh=${stats.freshCount} stale=${stats.staleCount} errors=${stats.errorCount} durationMs=${durationMs}`,
      );

      if (runId) {
        await writeShadowSyncProgress(runId, {
          phase: "sync_chunk",
          chunk: chunkIndex + 1,
          chunkCount: stats.chunkCount,
          durationMs,
          ...progressPayload(stats),
        });
      }
    }
  } catch (err) {
    stats.durationMs = Date.now() - startedAt;
    if (err instanceof ShadowSyncTimeoutError) {
      console.warn(
        `[shadow:sync] timeout after ${stats.durationMs}ms processed=${stats.processedCount}/${stats.selectedCount} partial=${stats.processedCount > 0}`,
      );
      if (runId) await finalizeTimeoutRun(runId, stats, err);
      return stats;
    }
    throw err;
  }

  stats.durationMs = Date.now() - startedAt;
  console.log(
    `[shadow:sync] done selected=${stats.selectedCount} processed=${stats.processedCount} updated=${stats.updatedCount} skipped=${stats.unchangedSkipped} fresh=${stats.freshCount} stale=${stats.staleCount} durationMs=${stats.durationMs}`,
  );

  return stats;
}
