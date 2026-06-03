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
  type TapePoint,
} from "@augurium/shadow";
import { buildMarketTapeForMarket, latestMarketTradePrice } from "../lib/market-tapes.js";

const SHADOW_SIGNAL_TYPES = ["TRADE_NOW", "WATCHLIST", "RESEARCH"];
const MAX_NEW_PER_RUN = Number(process.env.SHADOW_MAX_NEW ?? "100");
const MAX_UPDATE_PER_RUN = Number(process.env.SHADOW_MAX_UPDATE ?? "200");

export interface ShadowPortfolioSummary {
  created: number;
  updated: number;
  closed: number;
  simulations: number;
  replays: number;
}

async function resolveTapeForMarket(
  marketId: string,
  conditionId: string | null,
  outcomeSide: string,
): Promise<{ tape: TapePoint[]; asset: string | null }> {
  const trades = await prisma.trade.findMany({
    where: { marketId },
    orderBy: { tradedAt: "desc" },
    take: 50,
    select: { conditionId: true, asset: true, outcome: true, price: true, tradedAt: true },
  });

  if (!trades.length) return { tape: [], asset: null };

  const normalized = outcomeSide.toUpperCase();
  const match =
    trades.find((t) => (t.outcome ?? "").toUpperCase() === normalized) ?? trades[0];
  const cid = conditionId ?? match.conditionId;
  const tape = await buildMarketTapeForMarket(marketId, cid, match.asset);
  return { tape, asset: match.asset };
}

export async function runShadowPortfolioJob(): Promise<ShadowPortfolioSummary> {
  const run = await prisma.ingestionRun.create({
    data: { source: "shadow-portfolio", status: "running" },
  });

  const now = new Date();
  let created = 0;
  let updated = 0;
  let closed = 0;
  let simulations = 0;
  let replays = 0;

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

      const { tape } = await resolveTapeForMarket(
        signal.marketId,
        signal.conditionId,
        signal.side,
      );
      const entryMs = signal.createdAt.getTime() + DEFAULT_ENTRY_DELAY_MS;
      const entryResolved = resolveShadowPrice({
        entryMs: signal.createdAt.getTime(),
        entryPrice: 0,
        side: signal.side,
        tape,
        now,
      });
      const entryPrice =
        priceAtOrAfter(tape, entryMs) ??
        entryResolved.currentPrice ??
        (tape.length ? tape[tape.length - 1].price : 0.5);

      if (entryPrice <= 0) continue;

      const postEntry = resolveShadowPrice({
        entryMs,
        entryPrice,
        side: signal.side,
        tape,
        marketSnapshotPrice: await latestMarketTradePrice(signal.marketId),
        lastKnownPrice: entryPrice,
        now,
      });

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
      replays++;

      const sims = runAllSimulations({
        strategyName: "augurium_rules",
        entryDelayMs: DEFAULT_ENTRY_DELAY_MS,
        entryPrice,
        priceSeries: tape,
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
        simulations++;
      }

      created++;
    }

    const openShadows = await prisma.shadowTrade.findMany({
      where: { status: "OPEN" },
      include: { signal: { include: { market: true } } },
      take: MAX_UPDATE_PER_RUN,
    });

    for (const shadow of openShadows) {
      const { tape } = await resolveTapeForMarket(
        shadow.marketId,
        shadow.conditionId,
        shadow.side,
      );
      const entryMs = shadow.createdAt.getTime() + shadow.entryDelayMs;
      const snapshotPrice = await latestMarketTradePrice(shadow.marketId);
      const priced = resolveShadowPrice({
        entryMs,
        entryPrice: shadow.simulatedEntryPrice,
        side: shadow.side,
        tape,
        marketSnapshotPrice: snapshotPrice,
        lastKnownPrice: shadow.currentPrice,
        now,
      });

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

      const updateData = {
        currentPrice: priced.currentPrice,
        positionRemaining: nextState.positionRemaining,
        unrealizedPnl: nextState.unrealizedPnl,
        realizedPnl: nextState.realizedPnl,
        roi: nextState.roi,
        maxFavorableExcursion: nextState.maxFavorableExcursion,
        maxAdverseExcursion: nextState.maxAdverseExcursion,
        partialExitDone: nextState.partialExitDone,
        runnerActive: nextState.runnerActive,
        priceStatus: priced.priceStatus,
        priceSource: priced.priceSource,
        lastPriceUpdateAt: priced.lastPriceUpdateAt ?? shadow.lastPriceUpdateAt,
        latestReasoning: decision?.latestReasoning ?? shadow.latestReasoning,
        ...(decision
          ? {
              status: decision.status,
              closedAt: now,
              missedProfitAfterExit: decision.missedProfitAfterExit,
              wouldHaveBeenBetterToHold: decision.wouldHaveBeenBetterToHold,
            }
          : {}),
      };

      await prisma.shadowTrade.update({
        where: { id: shadow.id },
        data: updateData,
      });

      if (decision) closed++;
      else updated++;
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: created + updated,
        finishedAt: new Date(),
        metadata: { created, updated, closed, simulations, replays },
      },
    });

    return { created, updated, closed, simulations, replays };
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
