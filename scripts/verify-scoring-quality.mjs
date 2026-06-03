#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const wallets = await prisma.trader.count();
  const scored = await prisma.trader.count({ where: { lastScoredAt: { not: null } } });
  const lowSampleHighRank = await prisma.trader.count({
    where: {
      trades: { lt: 25 },
      rankingScore: { gt: 55 },
      lastScoredAt: { not: null },
    },
  });
  const avgConfidence = await prisma.trader.aggregate({
    where: { lastScoredAt: { not: null } },
    _avg: { confidenceScore: true },
  });
  const uncategorizedBest = await prisma.trader.count({
    where: {
      OR: [{ bestCategory: null }, { bestCategory: "Other" }, { bestCategory: "uncategorized" }],
      lastScoredAt: { not: null },
    },
  });

  const coveragePct = wallets > 0 ? (scored / wallets) * 100 : 0;
  const report = {
    passed: lowSampleHighRank < scored * 0.15,
    wallets,
    scoredTraders: scored,
    scoreCoveragePct: Number(coveragePct.toFixed(1)),
    lowSampleHighRankCount: lowSampleHighRank,
    avgConfidence: Number(((avgConfidence._avg.confidenceScore ?? 0) * 100).toFixed(1)),
    uncategorizedBestCategory: uncategorizedBest,
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
