import { prisma } from "@augurium/database";
import {
  applyAuguriumExitRules,
  buildReplayPayload,
  computePositionMetrics,
  DEFAULT_ENTRY_DELAY_MS,
  DEFAULT_SIZE_USD,
  ENTRY_DELAYS_MS,
  priceAtOrAfter,
  resolveShadowPrice,
  runAllSimulations,
  updateExcursions,
} from "@augurium/shadow";
import {
  bestMarketLatestTrade,
  loadShadowPriceSources,
  priceCheckReasonForResult,
} from "../lib/shadow-price-sources.js";
import { selectShadowSyncBatch } from "../lib/shadow-sync-batch.js";

const SHADOW_SIGNAL_TYPES = ["TRADE_NOW", "WATCHLIST", "RESEARCH"];
const MAX_NEW_PER_RUN = Number(process.env.SHADOW_MAX_NEW ?? "150");
const SHADOW_SYNC_BATCH_SIZE = Number(
  process.env.SHADOW_SYNC_BATCH_SIZE ?? process.env.SHADOW_MAX_UPDATE ?? "500",
);
const SHADOW_STALE_AFTER_MS = Number(
  process.env.SHADOW_PRICE_STALE_MS ?? String(6 * 60 * 60 * 1000),
);

export interface ShadowPortfolioSummary {
  processed: number;
  fresh: number;
  stale: number;
  noSource: number;
  noUpdate: number;
  closed: number;
  created: number;
  updated: number;
  simulations: number;
  replays: number;
}

function tallyStatus(
  status: string,
  counts: Pick<ShadowPortfolioSummary, "fresh" | "stale" | "noSource" | "noUpdate">,
): void {
  if (status === "FRESH") counts.fresh++;
  else if (status === "STALE") counts.stale++;
  else if (status === "NO_PRICE_SOURCE") counts.noSource++;
  else if (status === "NO_PRICE_UPDATE") counts.noUpdate++;
}

export async function runShadowPortfolioJob(): Promise<ShadowPortfolioSummary> {
  const run = await prisma.ingestionRun.create({
    data: { source: "shadow-portfolio", status: "running" },
  });

  const now = new Date();
  const summary: ShadowPortfolioSummary = {
    processed: 0,
    fresh: 0,
    stale: 0,
    noSource: 0,
    noUpdate: 0,
    closed: 0,
    created: 0,
    updated: 0,
    simulations: 0,
    replays: 0,
  };

  try {
    const signalsWithoutShadow = await prisma.signal.findMany({
      where: {
        signalType: { in: SHADOW_SIGNAL_TYPES },
        shadowTrade: null,
      },
      include: { market: true },
      orderBy: { createdAt: "desc" },
      take: MAX_NEW_PER_RUN,
    });

    for (const signal of signalsWithoutShadow) {
      const existing = await prisma.shadowTrade.findUnique({
        where: { signalId: signal.id },
      });
      if (existing) continue;

      const sources = await loadShadowPriceSources({
        marketId: signal.marketId,
        conditionId: signal.conditionId,
        outcomeSide: signal.side,
      });
      const bestTrade = bestMarketLatestTrade(sources);
      const entryMs = signal.createdAt.getTime() + DEFAULT_ENTRY_DELAY_MS;
      const entryResolved = resolveShadowPrice({
        entryMs: signal.createdAt.getTime(),
        entryPrice: 0,
        side: signal.side,
        tape: sources.tape,
        marketLatestTrade: bestTrade,
        now,
        staleAfterMs: SHADOW_STALE_AFTER_MS,
      });
      const entryPrice =
        priceAtOrAfter(sources.tape, entryMs) ??
        entryResolved.currentPrice ??
        (sources.tape.length ? sources.tape[sources.tape.length - 1]!.price : 0.5);

      if (entryPrice <= 0) continue;

      const postEntry = resolveShadowPrice({
        entryMs,
        entryPrice,
        side: signal.side,
        tape: sources.tape,
        marketLatestTrade: bestTrade,
        marketSnapshotPrice: sources.marketSnapshotPrice,
        lastKnownPrice: entryPrice,
        now,
        staleAfterMs: SHADOW_STALE_AFTER_MS,
      });
      tallyStatus(postEntry.priceStatus, summary);
      const checkReason = priceCheckReasonForResult(
        postEntry,
        bestTrade?.reason ?? null,
        SHADOW_STALE_AFTER_MS,
        now,
      );

      const metrics = computePositionMetrics(
        entryPrice,
        postEntry.currentPrice,
        DEFAULT_SIZE_USD,
        1,
        0,
        signal.side,
      );

      const shadow = await prisma.shadowTrade.create({
        data: {
          signalId: signal.id,
          marketId: signal.marketId,
          conditionId: signal.conditionId,
          side: signal.side,
          entryDelayMs: DEFAULT_ENTRY_DELAY_MS,
          simulatedEntryPrice: entryPrice,
          currentPrice: postEntry.currentPrice,
          simulatedSizeUsd: DEFAULT_SIZE_USD,
          positionRemaining: 1,
          unrealizedPnl: metrics.unrealizedPnl,
          realizedPnl: 0,
          roi: metrics.roi,
          status: "OPEN",
          entryReasoning: signal.reasoning,
          latestReasoning: signal.reasoning,
          maxFavorableExcursion: 0,
          maxAdverseExcursion: 0,
          priceStatus: postEntry.priceStatus,
          priceSource: postEntry.priceSource,
          lastPriceUpdateAt: postEntry.lastPriceUpdateAt,
          priceCheckedAt: now,
          priceCheckReason: checkReason,
        },
      });

      const recentTrades = await prisma.trade.findMany({
        where: { marketId: signal.marketId },
        orderBy: { tradedAt: "desc" },
        take: 15,
        select: {
          side: true,
          size: true,
          price: true,
          tradedAt: true,
          outcome: true,
        },
      });

      const traders = await prisma.trader.findMany({
        where: { address: { in: signal.triggerTraderWallets } },
        select: {
          address: true,
          rankingScore: true,
          copyabilityScore: true,
          tier: true,
        },
      });

      const payload = buildReplayPayload({
        capturedAt: now,
        signal: {
          id: signal.id,
          signalType: signal.signalType,
          side: signal.side,
          consensusScore: signal.consensusScore,
          alphaScore: signal.alphaScore,
          marketQualityScore: signal.marketQualityScore,
          systemConfidenceScore: signal.systemConfidenceScore,
          copyabilityScore: signal.copyabilityScore,
          informationEdgeScore: signal.informationEdgeScore,
          reasoning: signal.reasoning,
          createdAt: signal.createdAt.toISOString(),
        },
        market: {
          id: signal.market.id,
          title: signal.market.title,
          category: signal.market.category,
          active: signal.market.active,
          closed: signal.market.closed,
        },
        recentTrades: recentTrades.map((t) => ({
          ...t,
          tradedAt: t.tradedAt.toISOString(),
        })),
        triggerTraders: traders,
        simulatedSizeUsd: DEFAULT_SIZE_USD,
        entryDelayMs: DEFAULT_ENTRY_DELAY_MS,
        entryDelayLabel: "3m",
        reasoning: signal.reasoning,
      });

      await prisma.replaySnapshot.create({
        data: {
          signalId: signal.id,
          shadowTradeId: shadow.id,
          payload: payload as object,
        },
      });
      summary.replays++;

      const sims = runAllSimulations({
        strategyName: "augurium_rules",
        entryDelayMs: DEFAULT_ENTRY_DELAY_MS,
        entryPrice,
        priceSeries: sources.tape,
        signalCreatedAt: signal.createdAt,
        signalExpiresAt: signal.expiresAt,
        marketClosed: signal.market.closed || signal.market.resolved,
        simulatedSizeUsd: DEFAULT_SIZE_USD,
        side: signal.side,
      });

      for (const sim of sims) {
        await prisma.simulationResult.create({
          data: {
            shadowTradeId: shadow.id,
            strategyName: sim.strategyName,
            entryDelayMs: sim.entryDelayMs,
            entryPrice: sim.entryPrice,
            exitPrice: sim.exitPrice,
            roi: sim.roi,
            maxDrawdown: sim.maxDrawdown,
            holdingTimeMs: sim.holdingTimeMs,
            outcome: sim.outcome,
          },
        });
        summary.simulations++;
      }

      summary.created++;
    }

    const allShadows = await prisma.shadowTrade.findMany({
      include: { signal: { include: { market: true } } },
    });
    const syncBatch = selectShadowSyncBatch(allShadows, SHADOW_SYNC_BATCH_SIZE);

    for (const shadow of syncBatch) {
      summary.processed++;
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
      tallyStatus(priced.priceStatus, summary);
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
        summary.updated++;
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

      if (decision) summary.closed++;
      else summary.updated++;
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: summary.processed,
        finishedAt: new Date(),
        metadata: {
          processed: summary.processed,
          fresh: summary.fresh,
          stale: summary.stale,
          noSource: summary.noSource,
          noUpdate: summary.noUpdate,
          closed: summary.closed,
          created: summary.created,
          updated: summary.updated,
          simulations: summary.simulations,
          replays: summary.replays,
          batchSize: SHADOW_SYNC_BATCH_SIZE,
        },
      },
    });

    console.log(
      `[shadow:sync] processed=${summary.processed} fresh=${summary.fresh} stale=${summary.stale} noSource=${summary.noSource} noUpdate=${summary.noUpdate} closed=${summary.closed} created=${summary.created}`,
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}

export { ENTRY_DELAYS_MS };
