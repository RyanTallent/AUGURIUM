import { prisma } from "@augurium/database";
import {
  applyRiskToDecision,
  buildTraderTruth,
  canAddMarketExposure,
  capAllocationPct,
  copyEfficiencyScore,
  decideCopyTrader,
  evaluateCopyWeeklyStopLoss,
  isSourcePositionTooStale,
} from "@augurium/copy-trading";

const PAPER_BANKROLL = Number(process.env.COPY_PAPER_BANKROLL_USD ?? "10000");
const ENABLED = process.env.PAPER_COPY_ENABLED === "true";

export interface CopyPaperJobSummary {
  enabled: boolean;
  tradersEvaluated: number;
  copyEnabled: number;
  opened: number;
  closed: number;
  skipped: number;
  weeklyHalted: boolean;
  message: string;
}

export async function runCopyPaperJob(): Promise<CopyPaperJobSummary> {
  const weekly = await evaluateCopyWeeklyStopLoss(PAPER_BANKROLL);

  if (!ENABLED) {
    return {
      enabled: false,
      tradersEvaluated: 0,
      copyEnabled: 0,
      opened: 0,
      closed: 0,
      skipped: 0,
      weeklyHalted: weekly.halted,
      message: "PAPER_COPY_ENABLED is false — paper copy mirror idle",
    };
  }

  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: 120,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  const ranked: Array<{
    trader: (typeof traders)[number];
    truth: ReturnType<typeof buildTraderTruth>;
    decision: ReturnType<typeof applyRiskToDecision>;
    efficiency: number;
  }> = [];

  let copyEnabled = 0;
  const enabledTraderIds = new Set<string>();

  for (const t of traders) {
    const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
    const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
    const efficiency = copyEfficiencyScore(truth, decision);
    ranked.push({ trader: t, truth, decision, efficiency });
    const enabled = decision.recommendation === "COPY";
    if (enabled) {
      copyEnabled++;
      enabledTraderIds.add(t.id);
    }
    await prisma.copyTraderControl.upsert({
      where: { traderId: t.id },
      create: {
        traderId: t.id,
        copyDecision: decision.recommendation,
        copyScore: decision.copyScore,
        riskScore: decision.riskScore,
        expectedValue: decision.expectedValue,
        enabled,
        disabledReason: enabled ? null : decision.weaknesses[0] ?? "not COPY",
        strengths: decision.strengths,
        weaknesses: decision.weaknesses,
      },
      update: {
        copyDecision: decision.recommendation,
        copyScore: decision.copyScore,
        riskScore: decision.riskScore,
        expectedValue: decision.expectedValue,
        enabled,
        disabledReason: enabled ? null : decision.weaknesses[0] ?? "not COPY",
        strengths: decision.strengths,
        weaknesses: decision.weaknesses,
        evaluatedAt: new Date(),
      },
    });
  }

  const topCopyTraderIds = ranked
    .filter((r) => r.decision.recommendation === "COPY")
    .sort((a, b) => b.efficiency - a.efficiency)
    .slice(0, 40)
    .map((r) => r.trader.id);

  const openSource = await prisma.position.findMany({
    where: {
      status: "open",
      traderId: { in: topCopyTraderIds.length ? topCopyTraderIds : [...enabledTraderIds] },
    },
    include: {
      trader: { select: { address: true } },
      market: { select: { category: true } },
    },
  });

  const existing = await prisma.copyPaperPosition.findMany({
    where: { status: "OPEN" },
    select: {
      sourcePositionKey: true,
      id: true,
      traderId: true,
      marketId: true,
      mirroredSizeUsd: true,
    },
  });
  const existingKeys = new Set(existing.map((e) => e.sourcePositionKey));
  const sourceKeys = new Set(openSource.map((p) => p.externalKey));

  const openExposureRows = await prisma.copyPaperPosition.findMany({
    where: { status: "OPEN" },
    include: {
      trader: { select: { id: true, address: true } },
      market: { select: { id: true, category: true } },
    },
  });

  const exposureBase = openExposureRows.map((r) => ({
    traderId: r.traderId,
    address: r.trader.address,
    marketId: r.marketId,
    category: r.market.category,
    usd: r.mirroredSizeUsd,
  }));

  let opened = 0;
  let closed = 0;
  let skipped = 0;

  if (!weekly.canOpenNewMirrors) {
    skipped = openSource.filter((p) => !existingKeys.has(p.externalKey)).length;
  } else {
    for (const pos of openSource) {
      if (existingKeys.has(pos.externalKey)) continue;

      if (isSourcePositionTooStale(pos.pnl, pos.size, pos.avgPrice)) {
        skipped++;
        continue;
      }

      const pct = capAllocationPct(0.05);
      const sizeUsd = Math.round(PAPER_BANKROLL * pct * 100) / 100;
      if (sizeUsd <= 0) {
        skipped++;
        continue;
      }

      const cap = canAddMarketExposure(PAPER_BANKROLL, exposureBase, {
        traderId: pos.traderId,
        address: pos.trader.address,
        marketId: pos.marketId,
        category: pos.market.category,
        usd: sizeUsd,
      });
      if (!cap.allowed) {
        skipped++;
        continue;
      }

      await prisma.copyPaperPosition.create({
        data: {
          traderId: pos.traderId,
          sourcePositionKey: pos.externalKey,
          marketId: pos.marketId,
          side: pos.side,
          mirroredSizeUsd: sizeUsd,
          entryPrice: pos.avgPrice,
          currentPrice: pos.avgPrice,
          status: "OPEN",
        },
      });
      exposureBase.push({
        traderId: pos.traderId,
        address: pos.trader.address,
        marketId: pos.marketId,
        category: pos.market.category,
        usd: sizeUsd,
      });
      opened++;
    }
  }

  for (const e of existing) {
    if (sourceKeys.has(e.sourcePositionKey)) continue;
    const row = await prisma.copyPaperPosition.findUnique({ where: { id: e.id } });
    if (!row) continue;
    await prisma.copyPaperPosition.update({
      where: { id: e.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        realizedPnl: row.unrealizedPnl,
        roi: row.mirroredSizeUsd > 0 ? row.unrealizedPnl / row.mirroredSizeUsd : 0,
      },
    });
    closed++;
  }

  return {
    enabled: true,
    tradersEvaluated: traders.length,
    copyEnabled,
    opened,
    closed,
    skipped,
    weeklyHalted: weekly.halted,
    message: weekly.halted
      ? `weekly stop active: ${weekly.haltedReason}`
      : `paper copy: ${copyEnabled} COPY traders, ${opened} opened, ${closed} closed`,
  };
}
