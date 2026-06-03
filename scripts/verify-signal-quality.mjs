#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const active = await prisma.signal.findMany({
    where: { status: "active" },
    select: {
      signalType: true,
      systemConfidenceScore: true,
      triggerTraderWallets: true,
      triggerNotional: true,
      evidenceWindowMinutes: true,
      category: true,
    },
  });

  const thinTradeNow = active.filter(
    (s) =>
      s.signalType === "TRADE_NOW" &&
      (s.triggerTraderWallets.length < 3 || s.triggerNotional < 1000),
  ).length;

  const highConfThin = active.filter(
    (s) => s.systemConfidenceScore > 85 && s.triggerTraderWallets.length < 2,
  ).length;

  const byType = {};
  for (const s of active) {
    byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
  }

  const avgConf =
    active.length > 0
      ? active.reduce((a, s) => a + s.systemConfidenceScore, 0) / active.length
      : 0;

  const report = {
    passed: thinTradeNow === 0 && highConfThin < Math.max(1, active.length * 0.1),
    activeSignals: active.length,
    byType,
    avgSystemConfidence: Number(avgConf.toFixed(1)),
    thinTradeNowCount: thinTradeNow,
    highConfidenceThinEvidence: highConfThin,
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
