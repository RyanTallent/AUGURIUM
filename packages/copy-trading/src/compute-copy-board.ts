import { prisma } from "@augurium/database";
import { buildTraderTruth } from "./trader-truth.js";
import { decideCopyTrader, rankCopyDecisions, type CopyDecision } from "./copy-decision.js";
import { applyRiskToDecision } from "./copy-risk.js";
import { simulateCopyPortfolios, type CopyPortfolioStrategyResult } from "./copy-portfolio.js";
import type { TraderTruthMetrics } from "./trader-truth.js";

export interface CopyBoardReport {
  topTradersToday: CopyDecision[];
  improving: CopyDecision[];
  deteriorating: CopyDecision[];
  copyPositionsToday: Array<{
    traderAddress: string;
    marketTitle: string;
    side: string;
    size: number;
    avgPrice: number;
    recommendation: string;
  }>;
  strategies: CopyPortfolioStrategyResult[];
  generatedAt: string;
}

export async function computeCopyBoard(limit = 50): Promise<CopyBoardReport> {
  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: limit,
    include: {
      metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });

  const ranked: Array<{ decision: CopyDecision; truth: TraderTruthMetrics }> = [];
  for (const t of traders) {
    const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
    const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
    ranked.push({ decision, truth });
  }

  const decisions = rankCopyDecisions(ranked.map((r) => r.decision));
  const byAddr = new Map(ranked.map((r) => [r.decision.address, r]));

  const copyTraders = ranked
    .filter((r) => r.decision.recommendation === "COPY")
    .map((r) => r.decision.address);

  const openPositions = await prisma.position.findMany({
    where: {
      status: "open",
      trader: { address: { in: copyTraders } },
    },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true } },
    },
    take: 40,
  });

  return {
    topTradersToday: decisions.filter((d) => d.recommendation === "COPY").slice(0, 15),
    improving: decisions.filter((d) => byAddr.get(d.address)?.truth.formTrend === "improving").slice(0, 10),
    deteriorating: decisions
      .filter((d) => byAddr.get(d.address)?.truth.formTrend === "deteriorating")
      .slice(0, 10),
    copyPositionsToday: openPositions.map((p) => ({
      traderAddress: p.trader.address,
      marketTitle: p.market.title,
      side: p.side,
      size: p.size,
      avgPrice: p.avgPrice,
      recommendation: "COPY",
    })),
    strategies: simulateCopyPortfolios(ranked),
    generatedAt: new Date().toISOString(),
  };
}
