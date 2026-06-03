import { prisma } from "@augurium/database";
import {
  applyAuguriumExitRules,
  buildReplayPayload,
  computePositionMetrics,
  DEFAULT_ENTRY_DELAY_MS,
  DEFAULT_SIZE_USD,
  ENTRY_DELAYS_MS,
  priceAtOrAfter,
  runAllSimulations,
  updateExcursions,
  type TapePoint,
} from "@augurium/shadow";
import { buildMarketTapesForKeys } from "../lib/market-tapes.js";

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
  const key = `${cid}:${match.asset}`;
  const tapes = await buildMarketTapesForKeys(new Set([key]));
  return { tape: tapes.get(key) ?? [], asset: match.asset };
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
      const entryPrice =
        priceAtOrAfter(tape, entryMs) ??
        (tape.length ? tape[tape.length - 1].price : 0.5);

      if (entryPrice <= 0) continue;

      const metrics = computePositionMetrics(
        entryPrice,
        entryPrice,
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
          currentPrice: entryPrice,
          simulatedSizeUsd: DEFAULT_SIZE_USD,
          positionRemaining: 1,
          unrealizedPnl: 0,
          realizedPnl: 0,
          roi: 0,
          status: "OPEN",
          entryReasoning: signal.reasoning,
          latestReasoning: signal.reasoning,
          maxFavorableExcursion: 0,
          maxAdverseExcursion: 0,
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
      const currentPrice =
        tape.length > 0
          ? tape[tape.length - 1].price
          : shadow.currentPrice;

      let state = computePositionMetrics(
        shadow.simulatedEntryPrice,
        currentPrice,
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
          currentPrice,
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
        currentPrice,
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
