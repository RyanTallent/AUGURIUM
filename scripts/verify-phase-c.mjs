import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.signal.count();
  const active = await prisma.signal.count({ where: { status: "active" } });

  const byType = {
    TRADE_NOW: await prisma.signal.count({
      where: { status: "active", signalType: "TRADE_NOW" },
    }),
    WATCHLIST: await prisma.signal.count({
      where: { status: "active", signalType: "WATCHLIST" },
    }),
    RESEARCH: await prisma.signal.count({
      where: { status: "active", signalType: "RESEARCH" },
    }),
    IGNORE: await prisma.signal.count({
      where: { status: "active", signalType: "IGNORE" },
    }),
  };

  const topAlpha = await prisma.signal.findMany({
    where: { status: "active" },
    orderBy: { alphaScore: "desc" },
    take: 20,
    include: { market: { select: { title: true } } },
  });

  const topConsensus = await prisma.signal.findMany({
    where: { status: "active" },
    orderBy: { consensusScore: "desc" },
    take: 20,
    include: { market: { select: { title: true } } },
  });

  const disagreementExamples = await prisma.signal.findMany({
    where: { status: "active", disagreementScore: { gte: 0.4 } },
    orderBy: { disagreementScore: "desc" },
    take: 10,
    include: { market: { select: { title: true } } },
  });

  const ignoredSamples = await prisma.signal.findMany({
    where: { status: "active", signalType: "IGNORE" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { market: { select: { title: true } } },
  });

  const lastTrade = await prisma.trade.findFirst({
    orderBy: { tradedAt: "desc" },
    select: { tradedAt: true },
  });
  const lastSignalRun = await prisma.ingestionRun.findFirst({
    where: { source: "generate-signals" },
    orderBy: { startedAt: "desc" },
  });
  const lastScoreRun = await prisma.ingestionRun.findFirst({
    where: { source: "score-traders", status: "success" },
    orderBy: { finishedAt: "desc" },
  });

  const randomCheck = await prisma.signal.findMany({
    where: { status: "active" },
    take: 50,
    select: { reasoning: true, rationale: true },
  });
  const hasRandom = randomCheck.some(
    (s) =>
      /random/i.test(s.reasoning) ||
      /placeholder/i.test(s.reasoning) ||
      /mock/i.test(s.reasoning),
  );

  const passed = active > 0 && !hasRandom;

  const report = {
    phase: "C",
    passed,
    counts: {
      totalSignals: total,
      activeSignals: active,
      byType,
    },
    top20ByAlphaScore: topAlpha.map((s) => ({
      market: s.market.title,
      side: s.side,
      signalType: s.signalType,
      alphaScore: s.alphaScore,
      consensusScore: s.consensusScore,
      reasoning: s.reasoning.slice(0, 200),
    })),
    top20ByConsensusScore: topConsensus.map((s) => ({
      market: s.market.title,
      side: s.side,
      signalType: s.signalType,
      consensusScore: s.consensusScore,
      alphaScore: s.alphaScore,
      disagreementScore: s.disagreementScore,
    })),
    disagreementExamples: disagreementExamples.map((s) => ({
      market: s.market.title,
      side: s.side,
      signalType: s.signalType,
      consensusScore: s.consensusScore,
      disagreementScore: s.disagreementScore,
      opposingNote: `Side ${s.side} vs other sides — disagreement ${(s.disagreementScore * 100).toFixed(0)}%`,
      reasoning: s.reasoning.slice(0, 180),
    })),
    skippedIgnoredSamples: ignoredSamples.map((s) => ({
      market: s.market.title,
      side: s.side,
      alphaScore: s.alphaScore,
      consensusScore: s.consensusScore,
      reason: s.reasoning,
    })),
    dataFreshness: {
      lastTradeAt: lastTrade?.tradedAt ?? null,
      lastSignalRun: lastSignalRun
        ? {
            status: lastSignalRun.status,
            startedAt: lastSignalRun.startedAt,
            itemCount: lastSignalRun.itemCount,
            metadata: lastSignalRun.metadata,
          }
        : null,
      lastScoreRunAt: lastScoreRun?.finishedAt ?? null,
    },
    safety: {
      randomOrMockReasoningDetected: hasRandom,
      executionEnabled: false,
    },
    notes: [
      "Signals are advisory only — no order placement.",
      "TRADE_NOW requires consensus >= 85, alpha >= 80, quality and confidence gates.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
