import { prisma } from "@augurium/database";
import {
  applyRiskToDecision,
  buildTraderTruth,
  capAllocationPct,
  decideCopyTrader,
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
  message: string;
}

export async function runCopyPaperJob(): Promise<CopyPaperJobSummary> {
  if (!ENABLED) {
    return {
      enabled: false,
      tradersEvaluated: 0,
      copyEnabled: 0,
      opened: 0,
      closed: 0,
      skipped: 0,
      message: "PAPER_COPY_ENABLED is false — paper copy mirror idle",
    };
  }

  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: 80,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  let copyEnabled = 0;
  const enabledTraderIds = new Set<string>();

  for (const t of traders) {
    const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
    const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
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

  const openSource = await prisma.position.findMany({
    where: {
      status: "open",
      traderId: { in: [...enabledTraderIds] },
    },
    include: { trader: { select: { address: true } } },
  });

  const existing = await prisma.copyPaperPosition.findMany({
    where: { status: "OPEN" },
    select: { sourcePositionKey: true, id: true, traderId: true },
  });
  const existingKeys = new Set(existing.map((e) => e.sourcePositionKey));
  const sourceKeys = new Set(openSource.map((p) => p.externalKey));

  let opened = 0;
  let closed = 0;
  let skipped = 0;

  for (const pos of openSource) {
    if (existingKeys.has(pos.externalKey)) continue;
    const pct = capAllocationPct(0.05);
    const sizeUsd = Math.round(PAPER_BANKROLL * pct * 100) / 100;
    if (sizeUsd <= 0) {
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
    opened++;
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
    message: `paper copy mirror: ${copyEnabled} COPY traders, ${opened} opened, ${closed} closed`,
  };
}
