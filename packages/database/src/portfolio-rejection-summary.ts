import { prisma } from "./client.js";

export interface PortfolioRejectionSummary {
  totalDecisions: number;
  accepted: number;
  rejected: number;
  watch: number;
  reallocate: number;
  scale: number;
  reduce: number;
  acceptanceRate: number;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  topWatchReasons: Array<{ reason: string; count: number }>;
  executionBlocked: number;
  executionPlaced: number;
  executionFailed: number;
  topExecutionBlockReasons: Array<{ reason: string; count: number }>;
  paperOpens: number;
  paperCloses: number;
  behaviorAssessment: string;
  generatedAt: string;
}

function bumpReasons(map: Map<string, number>, reasons: string[]): void {
  for (const r of reasons) {
    const key = r.trim().slice(0, 120);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}

function topN(map: Map<string, number>, n = 12): Array<{ reason: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count }));
}

export async function computePortfolioRejectionSummary(): Promise<PortfolioRejectionSummary> {
  const [decisions, blockedOrders, placedOrders, failedOrders, paperOpens, paperCloses] =
    await Promise.all([
      prisma.portfolioDecision.findMany({
        select: { decision: true, reasons: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
      prisma.executionOrder.findMany({
        where: { status: "BLOCKED" },
        select: { blockReason: true },
        take: 500,
      }),
      prisma.executionOrder.count({ where: { status: { in: ["FILLED", "PARTIAL"] } } }),
      prisma.executionOrder.count({ where: { status: "FAILED" } }),
      prisma.executionPosition.count({ where: { provider: "paper", status: "OPEN" } }),
      prisma.executionPosition.count({ where: { provider: "paper", status: "CLOSED" } }),
    ]);

  let accepted = 0;
  let rejected = 0;
  let watch = 0;
  let reallocate = 0;
  let scale = 0;
  let reduce = 0;
  const rejectMap = new Map<string, number>();
  const watchMap = new Map<string, number>();

  for (const d of decisions) {
    switch (d.decision) {
      case "ACCEPT":
        accepted++;
        break;
      case "REJECT":
        rejected++;
        bumpReasons(rejectMap, d.reasons);
        break;
      case "WATCH":
        watch++;
        bumpReasons(watchMap, d.reasons);
        break;
      case "REALLOCATE":
        reallocate++;
        break;
      case "SCALE":
        scale++;
        break;
      case "REDUCE":
        reduce++;
        break;
      default:
        break;
    }
  }

  const execBlockMap = new Map<string, number>();
  for (const o of blockedOrders) {
    if (!o.blockReason) continue;
    for (const part of o.blockReason.split(";")) {
      const key = part.trim();
      if (key) execBlockMap.set(key, (execBlockMap.get(key) ?? 0) + 1);
    }
  }

  const total = decisions.length;
  const acceptanceRate = total > 0 ? accepted / total : 0;

  let behaviorAssessment =
    "Portfolio engine is recording decisions with reasons; review top rejection/watch strings.";
  if (total === 0) {
    behaviorAssessment =
      "No portfolio decisions yet — run portfolio:run after signals exist.";
  } else if (accepted === 0 && rejected + watch === total) {
    behaviorAssessment =
      "Zero accepts is expected when signals are RESEARCH/WATCHLIST, scores below thresholds, or capital caps are full — not necessarily a bug.";
  } else if (accepted > 0 && paperCloses === 0) {
    behaviorAssessment =
      "Accepts exist but paper closes are zero — check EXECUTION_ENABLED, EXECUTION_PROVIDER=paper, and TRADE_NOW + ACCEPT alignment.";
  }

  return {
    totalDecisions: total,
    accepted,
    rejected,
    watch,
    reallocate,
    scale,
    reduce,
    acceptanceRate,
    topRejectionReasons: topN(rejectMap),
    topWatchReasons: topN(watchMap),
    executionBlocked: blockedOrders.length,
    executionPlaced: placedOrders,
    executionFailed: failedOrders,
    topExecutionBlockReasons: topN(execBlockMap),
    paperOpens,
    paperCloses,
    behaviorAssessment,
    generatedAt: new Date().toISOString(),
  };
}
