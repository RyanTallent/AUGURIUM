import { prisma } from "@augurium/database";
import {
  applyAuguriumExitRules,
  computePositionMetrics,
  resolveShadowPrice,
  updateExcursions,
} from "@augurium/shadow";
import {
  bestMarketLatestTrade,
  loadShadowPriceSources,
  priceCheckReasonForResult,
} from "../lib/shadow-price-sources.js";
import {
  resolveShadowSyncBatchSize,
  selectShadowSyncBatch,
} from "../lib/shadow-sync-batch.js";

const SHADOW_STALE_AFTER_MS = Number(
  process.env.SHADOW_PRICE_STALE_MS ?? String(6 * 60 * 60 * 1000),
);

export interface ShadowPriceSyncStats {
  shadowTotal: number;
  selectedCount: number;
  processedCount: number;
  updatedCount: number;
  closedCount: number;
  freshCount: number;
  staleCount: number;
  noSourceCount: number;
  noUpdateCount: number;
  errorCount: number;
  batchSize: number;
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

/** Reprice up to SHADOW_SYNC_BATCH_SIZE shadow trades (fleet sync, no simulations). */
export async function runShadowPriceSync(now = new Date()): Promise<ShadowPriceSyncStats> {
  const batchSize = resolveShadowSyncBatchSize();
  const stats: ShadowPriceSyncStats = {
    shadowTotal: 0,
    selectedCount: 0,
    processedCount: 0,
    updatedCount: 0,
    closedCount: 0,
    freshCount: 0,
    staleCount: 0,
    noSourceCount: 0,
    noUpdateCount: 0,
    errorCount: 0,
    batchSize,
  };

  const allShadows = await prisma.shadowTrade.findMany({
    include: { signal: { include: { market: true } } },
  });
  stats.shadowTotal = allShadows.length;

  const syncBatch = selectShadowSyncBatch(allShadows, batchSize);
  stats.selectedCount = syncBatch.length;

  console.log(
    `[shadow:sync] fleet shadowTotal=${stats.shadowTotal} selectedCount=${stats.selectedCount} batchSize=${batchSize}`,
  );

  for (const shadow of syncBatch) {
    stats.processedCount++;
    try {
      const sources = await loadShadowPriceSources({
        marketId: shadow.marketId,
        conditionId: shadow.conditionId,
        outcomeSide: shadow.side,
      });
      const bestTrade = bestMarketLatestTrade(sources);
      const entryMs = shadow.createdAt.getTime() + shadow.entryDelayMs;
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

      const baseUpdate = {
        currentPrice: priced.currentPrice,
        priceStatus: priced.priceStatus,
        priceSource: priced.priceSource,
        lastPriceUpdateAt: priced.lastPriceUpdateAt ?? shadow.lastPriceUpdateAt,
        priceCheckedAt: now,
        priceCheckReason: checkReason,
      };

      if (shadow.status !== "OPEN") {
        await prisma.shadowTrade.update({
          where: { id: shadow.id },
          data: baseUpdate,
        });
        stats.updatedCount++;
        continue;
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
          consensusCollapsed:
            signal.status !== "active" || signal.consensusScore < 40,
        },
        shadow.entryReasoning,
      );

      await prisma.shadowTrade.update({
        where: { id: shadow.id },
        data: {
          ...baseUpdate,
          positionRemaining: nextState.positionRemaining,
          unrealizedPnl: nextState.unrealizedPnl,
          realizedPnl: nextState.realizedPnl,
          roi: nextState.roi,
          maxFavorableExcursion: nextState.maxFavorableExcursion,
          maxAdverseExcursion: nextState.maxAdverseExcursion,
          partialExitDone: nextState.partialExitDone,
          runnerActive: nextState.runnerActive,
          latestReasoning: decision?.latestReasoning ?? shadow.latestReasoning,
          ...(decision
            ? {
                status: decision.status,
                closedAt: now,
                missedProfitAfterExit: decision.missedProfitAfterExit,
                wouldHaveBeenBetterToHold: decision.wouldHaveBeenBetterToHold,
              }
            : {}),
        },
      });

      if (decision) stats.closedCount++;
      else stats.updatedCount++;
    } catch (err) {
      stats.errorCount++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[shadow:sync] error shadowId=${shadow.id}`, message);
    }
  }

  console.log(
    `[shadow:sync] selectedCount=${stats.selectedCount} processedCount=${stats.processedCount} updatedCount=${stats.updatedCount} freshCount=${stats.freshCount} staleCount=${stats.staleCount} noSourceCount=${stats.noSourceCount} noUpdateCount=${stats.noUpdateCount} closedCount=${stats.closedCount} errorCount=${stats.errorCount}`,
  );

  return stats;
}
