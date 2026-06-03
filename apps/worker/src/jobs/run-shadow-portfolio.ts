import { prisma } from "@augurium/database";
import {
  buildReplayPayload,
  computePositionMetrics,
  DEFAULT_ENTRY_DELAY_MS,
  DEFAULT_SIZE_USD,
  ENTRY_DELAYS_MS,
  priceAtOrAfter,
  resolveShadowPrice,
  runAllSimulations,
} from "@augurium/shadow";
import {
  bestMarketLatestTrade,
  loadShadowPriceSources,
  priceCheckReasonForResult,
} from "../lib/shadow-price-sources.js";
import { runShadowPriceSync, type ShadowPriceSyncStats } from "./shadow-price-sync.js";

const SHADOW_SIGNAL_TYPES = ["TRADE_NOW", "WATCHLIST", "RESEARCH"];
const MAX_NEW_PER_RUN = Number(process.env.SHADOW_MAX_NEW ?? "150");
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
  selectedCount: number;
  processedCount: number;
  updatedCount: number;
  freshCount: number;
  staleCount: number;
  shadowTotal: number;
  errorCount: number;
}

function syncToSummary(sync: ShadowPriceSyncStats): ShadowPortfolioSummary {
  return {
    processed: sync.processedCount,
    fresh: sync.freshCount,
    stale: sync.staleCount,
    noSource: sync.noSourceCount,
    noUpdate: sync.noUpdateCount,
    closed: sync.closedCount,
    created: 0,
    updated: sync.updatedCount,
    simulations: 0,
    replays: 0,
    selectedCount: sync.selectedCount,
    processedCount: sync.processedCount,
    updatedCount: sync.updatedCount,
    freshCount: sync.freshCount,
    staleCount: sync.staleCount,
    shadowTotal: sync.shadowTotal,
    errorCount: sync.errorCount,
  };
}

export async function runShadowPortfolioJob(): Promise<ShadowPortfolioSummary> {
  const run = await prisma.ingestionRun.create({
    data: { source: "shadow-portfolio", status: "running" },
  });

  const now = new Date();

  try {
    const sync = await runShadowPriceSync(now);
    const summary = syncToSummary(sync);

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

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: sync.processedCount,
        finishedAt: new Date(),
        metadata: {
          shadowTotal: sync.shadowTotal,
          selected: sync.selectedCount,
          processed: sync.processedCount,
          updated: sync.updatedCount,
          fresh: sync.freshCount,
          stale: sync.staleCount,
          noSource: sync.noSourceCount,
          noUpdate: sync.noUpdateCount,
          closed: sync.closedCount,
          errors: sync.errorCount,
          batchSize: sync.batchSize,
          created: summary.created,
          simulations: summary.simulations,
          replays: summary.replays,
        },
      },
    });

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
