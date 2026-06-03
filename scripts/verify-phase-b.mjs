import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EMERGING_TIERS = new Set(["PROSPECT", "RISING", "ELITE", "SUPER_ELITE"]);

async function main() {
  const scoredWhere = {
    metricsSnapshots: { some: { skipReason: null } },
  };

  const totalTraders = await prisma.trader.count();
  const scoredTraders = await prisma.trader.count({
    where: scoredWhere,
  });
  const snapshotCount = await prisma.traderMetricsSnapshot.count({
    where: { skipReason: null },
  });

  const topByRank = await prisma.trader.findMany({
    where: scoredWhere,
    orderBy: { rankingScore: "desc" },
    take: 20,
    select: {
      address: true,
      tier: true,
      rankingScore: true,
      copyabilityScore: true,
      estimatedCopiedRoi: true,
      informationEdgeScore: true,
      confidenceScore: true,
      trades: true,
      lowConfidence: true,
      bestCategory: true,
    },
  });

  const topByCopiedRoi = await prisma.trader.findMany({
    where: scoredWhere,
    orderBy: { estimatedCopiedRoi: "desc" },
    take: 20,
    select: {
      address: true,
      estimatedCopiedRoi: true,
      copyabilityScore: true,
      rankingScore: true,
    },
  });

  const topByEdge = await prisma.trader.findMany({
    where: scoredWhere,
    orderBy: { informationEdgeScore: "desc" },
    take: 20,
    select: {
      address: true,
      informationEdgeScore: true,
      rankingScore: true,
    },
  });

  const emerging = await prisma.trader.findMany({
    where: {
      tier: { in: ["PROSPECT", "RISING"] },
      lastScoredAt: { not: null },
      rankingScore: { gte: 50 },
    },
    orderBy: { rankingScore: "desc" },
    take: 30,
    select: {
      address: true,
      tier: true,
      rankingScore: true,
      trades: true,
      roi: true,
      estimatedCopiedRoi: true,
      copyabilityScore: true,
      informationEdgeScore: true,
    },
  });

  const specialists = await prisma.traderCategoryMetric.findMany({
    where: { specialistScore: { gte: 0.45 } },
    orderBy: { specialistScore: "desc" },
    take: 30,
    include: {
      snapshot: {
        select: {
          trader: { select: { address: true, tier: true } },
          capturedAt: true,
        },
      },
    },
  });

  const skippedSnapshots = await prisma.traderMetricsSnapshot.findMany({
    where: { skipReason: { not: null } },
    select: { skipReason: true },
  });

  const unscoredWithTrades = await prisma.trader.count({
    where: {
      lastScoredAt: null,
      tradeRows: { some: {} },
    },
  });

  const skipReasons = {};
  for (const s of skippedSnapshots) {
    const r = s.skipReason ?? "unknown";
    skipReasons[r] = (skipReasons[r] ?? 0) + 1;
  }

  const lowTradeTraders = await prisma.trader.findMany({
    where: {
      lastScoredAt: null,
      tradeRows: { some: {} },
    },
    select: {
      address: true,
      _count: { select: { tradeRows: true } },
    },
    take: 20,
  });

  const passed =
    scoredTraders > 0 &&
    snapshotCount > 0 &&
    topByRank.length > 0;

  const report = {
    phase: "B",
    passed,
    counts: {
      totalTraders,
      scoredTraders,
      snapshotCount,
      unscoredWithTrades,
    },
    top20ByRankingScore: topByRank,
    top20ByEstimatedCopiedRoi: topByCopiedRoi,
    top20ByInformationEdge: topByEdge,
    emergingTraders: emerging.filter((t) => EMERGING_TIERS.has(t.tier)),
    categorySpecialists: specialists.map((s) => ({
      address: s.snapshot.trader.address,
      category: s.category,
      specialistScore: s.specialistScore,
      roi: s.roi,
      tradeCount: s.tradeCount,
      tier: s.snapshot.trader.tier,
    })),
    skipped: {
      skipReasonsFromSnapshots: skipReasons,
      sampleUnscoredLowVolume: lowTradeTraders.map((t) => ({
        address: t.address,
        tradeCount: t._count.tradeRows,
        reason:
          t._count.tradeRows < 5
            ? "insufficient-trades-for-scoring"
            : "not-yet-scored-in-batch",
      })),
    },
    notes: [
      "Ranking weights copied ROI (35%) and copyability (25%) over raw ROI.",
      "Signals and execution remain disabled (Phase C+).",
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
