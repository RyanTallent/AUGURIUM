import { prisma } from "@augurium/database";
import {
  computeTraderMetrics,
  normalizeMarketCategory,
  type PositionInput,
  type TradeInput,
} from "@augurium/scoring";
import { buildMarketTapesForKeys } from "../lib/market-tapes.js";
import { pickTradersForScoring } from "./score-traders-select.js";

const TRADERS_PER_RUN = Number(process.env.SCORE_TRADERS_BATCH_SIZE ?? "250");
const MIN_TRADES_TO_SCORE = Number(process.env.SCORE_MIN_TRADES ?? "5");
const RESCORE_COOLDOWN_MS =
  Number(process.env.SCORE_RESCORE_COOLDOWN_HOURS ?? "24") * 60 * 60 * 1000;
const LOW_VALUE_MAX_TRADES = Number(process.env.SCORE_LOW_VALUE_MAX_TRADES ?? "15");
const LOW_VALUE_RESCORE_COOLDOWN_MS =
  Number(process.env.SCORE_LOW_VALUE_RESCORE_HOURS ?? "72") * 60 * 60 * 1000;

const eligibleWhere = {
  trades: { gte: MIN_TRADES_TO_SCORE },
  tradeRows: { some: { size: { gt: 0 } } },
} as const;

export interface ScoreTradersSummary {
  scored: number;
  skipped: number;
  remaining: number;
  durationMs: number;
  unscoredEligible: number;
  skipReasons: Record<string, number>;
}

export async function countUnscoredEligible(): Promise<number> {
  return prisma.trader.count({
    where: { ...eligibleWhere, lastScoredAt: null },
  });
}

export async function runScoreTradersJob(): Promise<ScoreTradersSummary> {
  const startedAt = Date.now();
  const run = await prisma.ingestionRun.create({
    data: { source: "score-traders", status: "running" },
  });

  const skipReasons: Record<string, number> = {};
  let scored = 0;
  let skipped = 0;
  const now = new Date();

  try {
    const unscoredEligible = await countUnscoredEligible();

    const [unscored, rescoreCandidates] = await Promise.all([
      prisma.trader.findMany({
        where: { ...eligibleWhere, lastScoredAt: null },
        orderBy: [{ trades: "desc" }],
        take: TRADERS_PER_RUN,
        select: {
          id: true,
          trades: true,
          lastScoredAt: true,
          lastActivityAt: true,
        },
      }),
      prisma.trader.findMany({
        where: {
          ...eligibleWhere,
          lastScoredAt: { not: null },
          lastActivityAt: { not: null },
        },
        orderBy: [{ lastScoredAt: "asc" }],
        take: TRADERS_PER_RUN * 2,
        select: {
          id: true,
          trades: true,
          lastScoredAt: true,
          lastActivityAt: true,
        },
      }),
    ]);

    const pickOptions = {
      batchSize: TRADERS_PER_RUN,
      minTrades: MIN_TRADES_TO_SCORE,
      rescoreCooldownMs: RESCORE_COOLDOWN_MS,
      lowValueMaxTrades: LOW_VALUE_MAX_TRADES,
      lowValueRescoreCooldownMs: LOW_VALUE_RESCORE_COOLDOWN_MS,
      now,
    };

    const picked = pickTradersForScoring(unscored, rescoreCandidates, pickOptions);
    const traderIds = picked.map((t) => t.id);

    if (traderIds.length === 0) {
      const durationMs = Date.now() - startedAt;
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          itemCount: 0,
          finishedAt: new Date(),
          metadata: {
            scored: 0,
            skipped: 0,
            remaining: unscoredEligible,
            durationMs,
            note: "no-eligible-traders",
          },
        },
      });
      console.log(
        `[score-traders] scored=0 skipped=0 remaining=${unscoredEligible} durationMs=${durationMs}`,
      );
      return {
        scored: 0,
        skipped: 0,
        remaining: unscoredEligible,
        durationMs,
        unscoredEligible,
        skipReasons: {},
      };
    }

    const traders = await prisma.trader.findMany({
      where: { id: { in: traderIds } },
    });
    const order = new Map(traderIds.map((id, i) => [id, i]));
    traders.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

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
        await prisma.trader.update({
          where: { id: trader.id },
          data: { lastScoredAt: now },
        });
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

    const remaining = await countUnscoredEligible();
    const durationMs = Date.now() - startedAt;

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: scored,
        finishedAt: new Date(),
        metadata: { scored, skipped, remaining, durationMs, skipReasons, unscoredEligible },
      },
    });

    console.log(
      `[score-traders] scored=${scored} skipped=${skipped} remaining=${remaining} durationMs=${durationMs}`,
      skipReasons,
    );

    return { scored, skipped, remaining, durationMs, unscoredEligible, skipReasons };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
