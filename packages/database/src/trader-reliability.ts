import { prisma } from "./client.js";

export interface TraderReliabilityRow {
  address: string;
  tier: string;
  rankingScore: number;
  trades: number;
  winRate: number;
  roi: number;
  lowConfidence: boolean;
  reliabilityScore: number;
  flags: string[];
}

export interface TraderReliabilityReport {
  topTraders: TraderReliabilityRow[];
  flaggedCount: number;
  generatedAt: string;
}

function computeReliability(
  trader: {
    trades: number;
    winRate: number;
    roi: number;
    rankingScore: number;
    lowConfidence: boolean;
    copyabilityScore: number;
  },
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = Math.min(100, trader.rankingScore);

  if (trader.trades < 10) {
    flags.push("tiny_sample");
    score *= 0.6;
  } else if (trader.trades < 25) {
    flags.push("small_sample");
    score *= 0.85;
  }

  if (trader.lowConfidence) {
    flags.push("low_confidence");
    score *= 0.75;
  }

  if (trader.winRate > 0.85 && trader.roi > 0.5 && trader.trades < 30) {
    flags.push("possible_fake_edge");
    score *= 0.7;
  }

  if (trader.copyabilityScore < 0.15) {
    flags.push("low_copyability");
    score *= 0.8;
  }

  if (trader.rankingScore > 80 && trader.roi < 0.05) {
    flags.push("rank_inflation");
    score *= 0.75;
  }

  return { score: Math.round(score * 10) / 10, flags };
}

export async function computeTraderReliability(limit = 100): Promise<TraderReliabilityReport> {
  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null } },
    orderBy: { rankingScore: "desc" },
    take: limit,
    select: {
      address: true,
      tier: true,
      rankingScore: true,
      trades: true,
      winRate: true,
      roi: true,
      lowConfidence: true,
      copyabilityScore: true,
    },
  });

  const topTraders: TraderReliabilityRow[] = traders.map((t) => {
    const { score, flags } = computeReliability(t);
    return {
      address: t.address,
      tier: t.tier,
      rankingScore: t.rankingScore,
      trades: t.trades,
      winRate: t.winRate,
      roi: t.roi,
      lowConfidence: t.lowConfidence,
      reliabilityScore: score,
      flags,
    };
  });

  return {
    topTraders,
    flaggedCount: topTraders.filter((t) => t.flags.length > 0).length,
    generatedAt: new Date().toISOString(),
  };
}
