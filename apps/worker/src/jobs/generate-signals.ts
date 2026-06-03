import { prisma } from "@augurium/database";
import {
  evaluateMarketSignals,
  type ConsensusTradeInput,
  type MarketQualityInput,
  type SystemConfidenceInput,
} from "@augurium/intelligence";

const WINDOW_MINUTES = Number(
  process.env.SIGNAL_WINDOW_MINUTES ??
    (process.env.SIGNAL_LOOKBACK_DAYS
      ? String(Number(process.env.SIGNAL_LOOKBACK_DAYS) * 24 * 60)
      : "1440"),
);
const SIGNAL_TTL_HOURS = Number(process.env.SIGNAL_TTL_HOURS ?? "6");
const MAX_MARKETS_PER_RUN = Number(process.env.SIGNAL_MAX_MARKETS ?? "200");

export interface GenerateSignalsSummary {
  generated: number;
  expired: number;
  byType: Record<string, number>;
}

export async function runGenerateSignalsJob(): Promise<GenerateSignalsSummary> {
  const run = await prisma.ingestionRun.create({
    data: { source: "generate-signals", status: "running" },
  });

  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000);
  const expiresAt = new Date(now.getTime() + SIGNAL_TTL_HOURS * 60 * 60 * 1000);
  const byType: Record<string, number> = {};
  let generated = 0;

  try {
    const scoredTraders = await prisma.trader.findMany({
      where: {
        lastScoredAt: { not: null },
        metricsSnapshots: { some: { skipReason: null } },
      },
      select: {
        id: true,
        address: true,
        rankingScore: true,
        estimatedCopiedRoi: true,
        copyabilityScore: true,
        informationEdgeScore: true,
        confidenceScore: true,
        recentFormScore: true,
        tier: true,
        lowConfidence: true,
      },
    });

    const traderById = new Map(scoredTraders.map((t) => [t.id, t]));

    const recentTrades = await prisma.trade.findMany({
      where: {
        tradedAt: { gte: cutoff },
        marketId: { not: null },
        traderId: { in: [...traderById.keys()] },
      },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            category: true,
            conditionId: true,
            active: true,
            closed: true,
            resolved: true,
            acceptingOrders: true,
            endDate: true,
          },
        },
      },
      orderBy: { tradedAt: "asc" },
    });

    const tradesByMarket = new Map<string, typeof recentTrades>();
    for (const t of recentTrades) {
      if (!t.marketId) continue;
      const list = tradesByMarket.get(t.marketId) ?? [];
      list.push(t);
      tradesByMarket.set(t.marketId, list);
    }

    const marketIds = [...tradesByMarket.keys()].slice(0, MAX_MARKETS_PER_RUN);

    const lastTrade = await prisma.trade.findFirst({
      orderBy: { tradedAt: "desc" },
      select: { tradedAt: true },
    });
    const lastIngest = await prisma.ingestionRun.findFirst({
      where: { status: "success", source: { contains: "polymarket" } },
      orderBy: { finishedAt: "desc" },
    });
    const lastScore = await prisma.ingestionRun.findFirst({
      where: { source: "score-traders", status: "success" },
      orderBy: { finishedAt: "desc" },
    });

    const [marketTotal, categorizedMarkets, shadowTotal, shadowFresh] = await Promise.all([
      prisma.market.count(),
      prisma.market.count({
        where: {
          AND: [
            { category: { not: null } },
            { category: { notIn: ["", "Other", "uncategorized"] } },
          ],
        },
      }),
      prisma.shadowTrade.count(),
      prisma.shadowTrade.count({
        where: { priceStatus: "FRESH" },
      }),
    ]);

    const tapeCoveragePct =
      marketIds.length > 0
        ? Math.min(
            100,
            Math.round(
              (recentTrades.filter((t) => t.marketId).length / recentTrades.length) * 100,
            ),
          )
        : 0;

    const systemInput: SystemConfidenceInput = {
      totalTrades: await prisma.trade.count(),
      recentTrades: recentTrades.length,
      tradesWithScoredTrader: recentTrades.length,
      scoredTraderCount: scoredTraders.length,
      marketsWithRecentActivity: marketIds.length,
      lastTradeAt: lastTrade?.tradedAt ?? null,
      lastIngestSuccessAt: lastIngest?.finishedAt ?? null,
      lastScoreSuccessAt: lastScore?.finishedAt ?? null,
      lastSignalRunSuccess: true,
      categorizedMarketsPct:
        marketTotal > 0 ? (categorizedMarkets / marketTotal) * 100 : 0,
      shadowPriceFreshPct: shadowTotal > 0 ? (shadowFresh / shadowTotal) * 100 : 0,
      tapeCoveragePct,
      now,
    };

    const expired = await prisma.signal.updateMany({
      where: { status: "active", marketId: { in: marketIds } },
      data: { status: "expired" },
    });

    for (const marketId of marketIds) {
      const marketTrades = tradesByMarket.get(marketId) ?? [];
      if (marketTrades.length === 0) continue;

      const market = marketTrades[0].market;
      if (!market) continue;

      const consensusTrades: ConsensusTradeInput[] = [];
      for (const t of marketTrades) {
        const trader = traderById.get(t.traderId);
        if (!trader) continue;
        consensusTrades.push({
          tradeId: t.id,
          wallet: trader.address,
          marketId,
          conditionId: t.conditionId,
          side: t.side,
          outcome: t.outcome,
          size: t.size,
          price: t.price,
          tradedAt: t.tradedAt,
          trader: {
            rankingScore: trader.rankingScore,
            estimatedCopiedRoi: trader.estimatedCopiedRoi,
            copyabilityScore: trader.copyabilityScore,
            informationEdgeScore: trader.informationEdgeScore,
            confidenceScore: trader.confidenceScore,
            recentFormScore: trader.recentFormScore,
            tier: trader.tier,
            lowConfidence: trader.lowConfidence,
          },
        });
      }

      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const qualityInput: MarketQualityInput = {
        marketId,
        active: market.active,
        closed: market.closed,
        resolved: market.resolved,
        acceptingOrders: market.acceptingOrders,
        endDate: market.endDate,
        recentTrades: marketTrades.map((t) => ({
          price: t.price,
          size: t.size,
          tradedAt: t.tradedAt,
        })),
        volume7d: marketTrades.reduce((s, t) => s + t.size * t.price, 0),
        tradeCount7d: marketTrades.length,
        tradeCount24h: marketTrades.filter((t) => t.tradedAt >= cutoff24h).length,
        uniqueTraders7d: new Set(marketTrades.map((t) => t.traderId)).size,
      };

      const evaluations = evaluateMarketSignals(
        marketId,
        market.conditionId,
        market.category,
        consensusTrades,
        qualityInput,
        systemInput,
        now,
      );

      let bestAlpha = 0;
      let bestType: string | null = null;
      let bestConsensus = 0;

      for (const ev of evaluations) {
        await prisma.signal.create({
          data: {
            marketId: ev.marketId,
            conditionId: ev.conditionId,
            category: ev.category,
            side: ev.outcomeSide,
            outcome: ev.outcomeSide,
            signalType: ev.signalType,
            consensusScore: ev.consensus.consensusScore,
            alphaScore: ev.alphaScore,
            marketQualityScore: ev.marketQualityScore,
            systemConfidenceScore: ev.systemConfidenceScore,
            copyabilityScore: ev.consensus.copyabilityScore,
            informationEdgeScore: ev.consensus.informationEdgeScore,
            convictionScore: ev.consensus.convictionScore,
            disagreementScore: ev.consensus.disagreementScore,
            triggerTradeIds: ev.consensus.triggerTradeIds,
            triggerTraderWallets: ev.consensus.triggerTraderWallets,
            triggerNotional: ev.consensus.combinedNotional,
            oldestTriggerTradeAt: ev.consensus.oldestTriggerTradeAt,
            newestTriggerTradeAt: ev.consensus.newestTriggerTradeAt,
            evidenceWindowMinutes: ev.evidenceWindowMinutes,
            reasoning: ev.reasoning,
            rationale: ev.reasoning,
            confidence: ev.systemConfidenceScore / 100,
            status: "active",
            expiresAt,
          },
        });

        byType[ev.signalType] = (byType[ev.signalType] ?? 0) + 1;
        generated++;

        if (ev.alphaScore > bestAlpha) {
          bestAlpha = ev.alphaScore;
          bestType = ev.signalType;
          bestConsensus = ev.consensus.consensusScore;
        }
      }

      await prisma.market.update({
        where: { id: marketId },
        data: {
          marketQualityScore: evaluations[0]?.marketQualityScore ?? null,
          lastAlphaScore: bestAlpha || null,
          lastConsensusScore: bestConsensus || null,
          lastSignalType: bestType,
        },
      });
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: generated,
        finishedAt: new Date(),
        metadata: { generated, expired: expired.count, byType },
      },
    });

    return { generated, expired: expired.count, byType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
