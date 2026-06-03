import { prisma } from "@augurium/database";
import {
  computeTraderMetrics,
  normalizeMarketCategory,
  type PositionInput,
  type TradeInput,
} from "@augurium/scoring";
import { buildMarketTapesForKeys } from "../lib/market-tapes.js";

const TRADERS_PER_RUN = Number(process.env.SCORE_TRADERS_BATCH_SIZE ?? "50");
const MIN_TRADES_TO_SCORE = 5;

export interface ScoreTradersSummary {
  scored: number;
  skipped: number;
  skipReasons: Record<string, number>;
}

export async function runScoreTradersJob(): Promise<ScoreTradersSummary> {
  const run = await prisma.ingestionRun.create({
    data: { source: "score-traders", status: "running" },
  });

  const skipReasons: Record<string, number> = {};
  let scored = 0;
  let skipped = 0;
  const now = new Date();

  try {
    const candidateTraders = await prisma.trader.findMany({
      where: { trades: { gte: MIN_TRADES_TO_SCORE } },
      orderBy: [{ lastScoredAt: "asc" }, { trades: "desc" }],
      take: TRADERS_PER_RUN * 3,
    });

    const traders = candidateTraders
      .filter(
        (t) =>
          t.lastScoredAt == null ||
          (t.lastActivityAt != null && t.lastActivityAt > t.lastScoredAt),
      )
      .slice(0, TRADERS_PER_RUN);

    if (traders.length === 0) {
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          itemCount: 0,
          finishedAt: new Date(),
          metadata: { scored: 0, skipped: 0, skipReasons: {}, note: "all-traders-scored" },
        },
      });
      return { scored: 0, skipped: 0, skipReasons: {} };
    }

    for (const trader of traders) {
      const tradeRows = await prisma.trade.findMany({
        where: { traderId: trader.id },
        include: { market: { select: { category: true, title: true } } },
        orderBy: { tradedAt: "asc" },
      });

      if (tradeRows.length === 0) {
        skipped++;
        skipReasons["no-trades"] = (skipReasons["no-trades"] ?? 0) + 1;
        continue;
      }

      const tapeKeys = new Set(
        tradeRows.map((t) => `${t.conditionId}:${t.asset}`),
      );
      const marketTapes = await buildMarketTapesForKeys(tapeKeys);

      const trades: TradeInput[] = tradeRows.map((t) => ({
        id: t.id,
        side: t.side,
        size: t.size,
        price: t.price,
        tradedAt: t.tradedAt,
        conditionId: t.conditionId,
        asset: t.asset,
        marketId: t.marketId,
        category: normalizeMarketCategory({
          gammaCategory: t.market?.category,
          title: t.market?.title,
        }),
      }));

      const positionRows = await prisma.position.findMany({
        where: { traderId: trader.id },
        include: { market: { select: { category: true, title: true } } },
      });

      const positions: PositionInput[] = positionRows.map((p) => ({
        pnl: p.pnl,
        size: p.size,
        avgPrice: p.avgPrice,
        status: p.status,
        category: normalizeMarketCategory({
          gammaCategory: p.market?.category,
        }),
      }));

      const metrics = computeTraderMetrics(trades, positions, marketTapes, now);

      if (metrics.skipReason) {
        skipped++;
        skipReasons[metrics.skipReason] = (skipReasons[metrics.skipReason] ?? 0) + 1;
        continue;
      }

      const snapshot = await prisma.traderMetricsSnapshot.create({
        data: {
          traderId: trader.id,
          capturedAt: now,
          tradeCount: metrics.tradeCount,
          marketCount: metrics.marketCount,
          totalVolume: metrics.totalVolume,
          firstSeen: metrics.firstSeen,
          lastSeen: metrics.lastSeen,
          activeDays: metrics.activeDays,
          averageTradeSize: metrics.averageTradeSize,
          averagePositionSize: metrics.averagePositionSize,
          realizedPnl: metrics.realizedPnl,
          unrealizedPnl: metrics.unrealizedPnl,
          estimatedTotalPnl: metrics.estimatedTotalPnl,
          roi: metrics.roi,
          winRate: metrics.winRate,
          lossRate: metrics.lossRate,
          averageWin: metrics.averageWin,
          averageLoss: metrics.averageLoss,
          profitFactor: metrics.profitFactor,
          maxDrawdown: metrics.maxDrawdown,
          consistencyScore: metrics.consistencyScore,
          roi7d: metrics.roi7d,
          roi30d: metrics.roi30d,
          roi90d: metrics.roi90d,
          roi180d: metrics.roi180d,
          volume7d: metrics.volume7d,
          volume30d: metrics.volume30d,
          tradeCount7d: metrics.tradeCount7d,
          tradeCount30d: metrics.tradeCount30d,
          copyabilityScore: metrics.copyabilityScore,
          estimatedCopiedRoi: metrics.estimatedCopiedRoi,
          averageSlippageEstimate: metrics.averageSlippageEstimate,
          averageExecutionDelayEstimate: metrics.averageExecutionDelayEstimate,
          mirrorabilityScore: metrics.mirrorabilityScore,
          copiedProfitFactor: metrics.copiedProfitFactor,
          informationEdgeScore: metrics.informationEdgeScore,
          confidenceScore: metrics.confidenceScore,
          recentFormScore: metrics.recentFormScore,
          rankingScore: metrics.rankingScore,
          tier: metrics.tier,
          bestCategory: metrics.bestCategory,
          specialistCategory: metrics.specialistCategory,
          specialistScore: metrics.specialistScore,
          lowConfidence: metrics.lowConfidence,
          skipReason: metrics.skipReason,
          confidenceReason: metrics.confidenceReason,
          rankingReason: metrics.rankingReason,
          copyabilityReason: metrics.copyabilityReason,
          categoryMetrics: {
            create: metrics.categoryMetrics.map((c) => ({
              category: c.category,
              tradeCount: c.tradeCount,
              volume: c.volume,
              roi: c.roi,
              winRate: c.winRate,
              specialistScore: c.specialistScore,
            })),
          },
        },
      });

      await prisma.traderScoreHistory.create({
        data: {
          traderId: trader.id,
          capturedAt: now,
          rankingScore: metrics.rankingScore,
          copyabilityScore: metrics.copyabilityScore,
          estimatedCopiedRoi: metrics.estimatedCopiedRoi,
          informationEdgeScore: metrics.informationEdgeScore,
          confidenceScore: metrics.confidenceScore,
          consistencyScore: metrics.consistencyScore,
          recentFormScore: metrics.recentFormScore,
          rawRoi: metrics.roi,
        },
      });

      const lastTier = await prisma.traderTierHistory.findFirst({
        where: { traderId: trader.id },
        orderBy: { capturedAt: "desc" },
      });

      if (!lastTier || lastTier.tier !== metrics.tier) {
        await prisma.traderTierHistory.create({
          data: {
            traderId: trader.id,
            tier: metrics.tier,
            rankingScore: metrics.rankingScore,
            capturedAt: now,
          },
        });
      }

      await prisma.trader.update({
        where: { id: trader.id },
        data: {
          score: metrics.rankingScore,
          winRate: metrics.winRate,
          roi: metrics.roi,
          trades: metrics.tradeCount,
          tier: metrics.tier,
          rankingScore: metrics.rankingScore,
          copyabilityScore: metrics.copyabilityScore,
          estimatedCopiedRoi: metrics.estimatedCopiedRoi,
          informationEdgeScore: metrics.informationEdgeScore,
          confidenceScore: metrics.confidenceScore,
          recentFormScore: metrics.recentFormScore,
          bestCategory: metrics.bestCategory,
          lowConfidence: metrics.lowConfidence,
          lastScoredAt: now,
          lastActivityAt: metrics.lastSeen ?? trader.lastActivityAt,
        },
      });

      scored++;
      void snapshot;
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: scored,
        finishedAt: new Date(),
        metadata: { scored, skipped, skipReasons },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    throw err;
  }

  return { scored, skipped, skipReasons };
}
