#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function discordEnv() {
  const enabled =
    process.env.DISCORD_ENABLED === "true" ||
    process.env.DISCORD_ENABLED === "1";
  const webhook = Boolean((process.env.DISCORD_WEBHOOK_URL ?? "").trim());
  return { enabled, webhookConfigured: webhook, canSend: enabled && webhook };
}

async function main() {
  const discord = discordEnv();
  const [
    markets,
    categorized,
    wallets,
    scoredTraders,
    signalsByType,
    shadowTotal,
    shadowFresh,
    avgSystemConf,
    lastIngest,
  ] = await Promise.all([
    prisma.market.count(),
    prisma.market.count({
      where: {
        AND: [
          { category: { not: null } },
          { category: { notIn: ["", "Other", "uncategorized"] } },
        ],
      },
    }),
    prisma.trader.count(),
    prisma.trader.count({ where: { lastScoredAt: { not: null } } }),
    prisma.signal.groupBy({ by: ["signalType"], where: { status: "active" }, _count: true }),
    prisma.shadowTrade.count(),
    prisma.shadowTrade.count({ where: { priceStatus: "FRESH" } }),
    prisma.signal.aggregate({
      where: { status: "active" },
      _avg: { systemConfidenceScore: true },
    }),
    prisma.ingestionRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  const warnings = [];
  if (!discord.canSend) {
    warnings.push(
      "Discord not configured — set DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL on Render",
    );
  }
  const categoryPct = markets > 0 ? (categorized / markets) * 100 : 0;
  if (categoryPct < 40) warnings.push("Low categorized markets %");
  const scorePct = wallets > 0 ? (scoredTraders / wallets) * 100 : 0;
  if (scorePct < 15) warnings.push("Low scored-trader coverage");
  const shadowPct = shadowTotal > 0 ? (shadowFresh / shadowTotal) * 100 : 0;
  if (shadowTotal > 0 && shadowPct < 25) warnings.push("Shadow price updates mostly stale");

  const report = {
    passed: warnings.length === 0,
    markets,
    categorizedMarketsPct: Number(categoryPct.toFixed(1)),
    wallets,
    scoredTraders,
    scoreCoveragePct: Number(scorePct.toFixed(1)),
    signalsByType: Object.fromEntries(signalsByType.map((s) => [s.signalType, s._count])),
    avgSystemConfidence: Number((avgSystemConf._avg.systemConfidenceScore ?? 0).toFixed(1)),
    shadowTrades: shadowTotal,
    shadowPriceFreshPct: Number(shadowPct.toFixed(1)),
    discord,
    workerLastIngestion: lastIngest
      ? { source: lastIngest.source, status: lastIngest.status, startedAt: lastIngest.startedAt }
      : null,
    warnings,
    safety: {
      liveExecution: process.env.EXECUTION_ENABLED === "true",
      liveTrading: process.env.LIVE_TRADING_ENABLED === "true",
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
