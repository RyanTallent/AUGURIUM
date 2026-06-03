import { prisma } from "@augurium/database";
import {
  computeScoringHealth,
  scoringWarningMessage,
  type ScoringHealthMetrics,
} from "@augurium/database";

const MIN_TRADES_ELIGIBLE = Number(process.env.SCORE_MIN_TRADES ?? "5");

const eligibleWhere = {
  trades: { gte: MIN_TRADES_ELIGIBLE },
  tradeRows: { some: { size: { gt: 0 } } },
} as const;

export async function getScoringHealthMetrics(): Promise<ScoringHealthMetrics> {
  const [scoredWallets, unscoredEligibleRemaining] = await Promise.all([
    prisma.trader.count({ where: { lastScoredAt: { not: null } } }),
    prisma.trader.count({
      where: { ...eligibleWhere, lastScoredAt: null },
    }),
  ]);
  return computeScoringHealth(scoredWallets, unscoredEligibleRemaining);
}

export { scoringWarningMessage };
