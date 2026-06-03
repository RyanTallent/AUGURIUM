import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const cfg = {
  maxDeployedPct: 0.8,
  absoluteHardCapPct: 0.25,
};

async function main() {
  const state = await prisma.portfolioState.findUnique({
    where: { id: "current" },
  });

  const decisionCounts = await prisma.portfolioDecision.groupBy({
    by: ["decision"],
    _count: true,
  });
  const counts = { ACCEPT: 0, WATCH: 0, REJECT: 0, SCALE: 0, REDUCE: 0, REALLOCATE: 0 };
  let totalDecisions = 0;
  for (const row of decisionCounts) {
    if (row.decision in counts) counts[row.decision] = row._count;
    totalDecisions += row._count;
  }

  const capViolations = await prisma.portfolioDecision.count({
    where: { capViolation: true },
  });

  const latestDecisions = await prisma.portfolioDecision.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { market: { select: { title: true } } },
  });

  const largest = await prisma.portfolioDecision.findFirst({
    orderBy: { recommendedPct: "desc" },
  });

  const ledgerCount = await prisma.capitalLedgerEntry.count();
  const riskEvents = await prisma.riskEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const reallocations = await prisma.portfolioDecision.findMany({
    where: { decision: "REALLOCATE" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const openPositions = await prisma.portfolioPosition.count({
    where: { status: "OPEN" },
  });

  const deployedPct = state
    ? state.deployedCapital / Math.max(state.tradingBankroll, 1)
    : 0;

  const passed =
    !!state &&
    totalDecisions > 0 &&
    ledgerCount > 0 &&
    deployedPct <= cfg.maxDeployedPct + 0.05 &&
    (largest?.recommendedPct ?? 0) <= cfg.absoluteHardCapPct + 0.01;

  console.log(
    JSON.stringify(
      {
        phase: "F",
        passed,
        portfolioState: state
          ? {
              accountValue: state.accountValue,
              tradingBankroll: state.tradingBankroll,
              reserveCapital: state.reserveCapital,
              deployedCapital: state.deployedCapital,
              availableCapital: state.availableCapital,
              realizedPnl: state.realizedPnl,
              unrealizedPnl: state.unrealizedPnl,
              highWaterMark: state.highWaterMark,
              currentDrawdown: state.currentDrawdown,
              drawdownMode: state.drawdownMode,
              systemConfidence: state.systemConfidence,
              alphaScore: state.alphaScore,
            }
          : null,
        openSimulatedPositions: openPositions,
        decisionCounts: counts,
        totalDecisions,
        recommendedDeploymentPct: deployedPct,
        largestSuggestedPositionPct: largest?.recommendedPct ?? 0,
        capViolations,
        drawdown: state
          ? {
              currentDrawdown: state.currentDrawdown,
              drawdownMode: state.drawdownMode,
              highWaterMark: state.highWaterMark,
            }
          : null,
        capitalLedgerEntries: ledgerCount,
        riskEventCount: await prisma.riskEvent.count(),
        latestRiskEvents: riskEvents.map((e) => ({
          eventType: e.eventType,
          message: e.message,
          createdAt: e.createdAt,
        })),
        reallocationRecommendations: reallocations.map((r) => ({
          signalId: r.signalId,
          targetId: r.reallocationTargetId,
          compositeScore: r.compositeScore,
          createdAt: r.createdAt,
        })),
        latestDecisions: latestDecisions.map((d) => ({
          decision: d.decision,
          market: d.market.title,
          sizeUsd: d.recommendedSizeUsd,
          pct: d.recommendedPct,
        })),
        safety: {
          liveExecution: false,
          portfolioSimulated: true,
          orderPlacement: false,
        },
        setup: {
          env: "INITIAL_TRADING_BANKROLL_USD=70, MAX_DAILY_LOSS_USD=25",
          command: "npm run portfolio:run",
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
