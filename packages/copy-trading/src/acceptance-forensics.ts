import { prisma, computePortfolioRejectionSummary } from "@augurium/database";

export interface AcceptanceForensicsReport {
  accepted: number;
  rejected: number;
  watch: number;
  acceptanceRate: number;
  thresholdBottlenecks: string[];
  signalBottlenecks: string[];
  allocationBottlenecks: string[];
  topRejectionReasons: Array<{ reason: string; count: number }>;
  compositeScoreHistogram: Record<string, number>;
  behaviorAssessment: string;
  generatedAt: string;
}

function bump(hist: Record<string, number>, key: string): void {
  hist[key] = (hist[key] ?? 0) + 1;
}

export async function computeAcceptanceForensics(): Promise<AcceptanceForensicsReport> {
  const [summary, decisions, activeSignals] = await Promise.all([
    computePortfolioRejectionSummary(),
    prisma.portfolioDecision.findMany({
      select: { decision: true, reasons: true, compositeScore: true },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.signal.groupBy({
      by: ["signalType"],
      where: { status: "active" },
      _count: { id: true },
    }),
  ]);

  const hist: Record<string, number> = {};
  for (const d of decisions) {
    if (d.decision !== "REJECT") continue;
    const bucket =
      d.compositeScore >= 75
        ? "75-79"
        : d.compositeScore >= 70
          ? "70-74"
          : d.compositeScore >= 60
            ? "60-69"
            : "<60";
    bump(hist, bucket);
  }

  const thresholdBottlenecks: string[] = [];
  const signalBottlenecks: string[] = [];
  const allocationBottlenecks: string[] = [];

  const below80 = (hist["60-69"] ?? 0) + (hist["<60"] ?? 0) + (hist["70-74"] ?? 0);
  if (below80 > 0) {
    thresholdBottlenecks.push(
      `${below80} rejections with composite < 80 (ACCEPT requires ≥80 — not lowered)`,
    );
  }
  if ((hist["75-79"] ?? 0) > 0) {
    thresholdBottlenecks.push(
      `${hist["75-79"]} near-miss rejections in 75–79 band (WATCH only)`,
    );
  }

  const tradeNow = activeSignals.find((s) => s.signalType === "TRADE_NOW")?._count.id ?? 0;
  const research = activeSignals.find((s) => s.signalType === "RESEARCH")?._count.id ?? 0;
  if (tradeNow === 0) {
    signalBottlenecks.push("no active TRADE_NOW signals — execution path starved");
  }
  if (research > tradeNow * 3) {
    signalBottlenecks.push("many RESEARCH signals vs TRADE_NOW — promotion funnel blocked");
  }

  for (const r of summary.topRejectionReasons.slice(0, 8)) {
    if (r.reason.includes("deployed") || r.reason.includes("cap")) {
      allocationBottlenecks.push(r.reason);
    }
    if (r.reason.includes("duplicate market")) {
      allocationBottlenecks.push(r.reason);
    }
    if (r.reason.includes("preferred max open")) {
      allocationBottlenecks.push(r.reason);
    }
  }

  if (summary.accepted === 0) {
    allocationBottlenecks.push(
      "ACCEPT count is 0 — portfolio engine has not approved any simulated allocation",
    );
  }

  return {
    accepted: summary.accepted,
    rejected: summary.rejected,
    watch: summary.watch,
    acceptanceRate: summary.acceptanceRate,
    thresholdBottlenecks,
    signalBottlenecks,
    allocationBottlenecks,
    topRejectionReasons: summary.topRejectionReasons,
    compositeScoreHistogram: hist,
    behaviorAssessment: summary.behaviorAssessment,
    generatedAt: new Date().toISOString(),
  };
}
