#!/usr/bin/env node
import { getProductionHealthReport } from "@augurium/database";

function discordEnv() {
  const enabled =
    process.env.DISCORD_ENABLED === "true" ||
    process.env.DISCORD_ENABLED === "1";
  const webhook = Boolean((process.env.DISCORD_WEBHOOK_URL ?? "").trim());
  return { enabled, webhookConfigured: webhook, canSend: enabled && webhook };
}

async function main() {
  const discord = discordEnv();
  const health = await getProductionHealthReport();

  const warnings = [];
  if (!discord.canSend) {
    warnings.push(
      "Discord not configured — set DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL on Render",
    );
  }
  if (health.scoreCoveragePct < 15) {
    warnings.push(
      `Low scored-trader coverage (${health.scoreCoveragePct}%, ${health.unscoredEligibleRemaining} eligible unscored remaining)`,
    );
  }
  if (health.shadowTotal > 0 && health.shadowFreshPct < 25) {
    warnings.push(
      `Shadow price updates mostly stale (${health.shadowFreshPct}% FRESH, ${health.shadowStalePct}% STALE)`,
    );
  }

  const report = {
    passed: warnings.length === 0,
    ...health,
    discord,
    warnings,
    safety: {
      liveExecution: process.env.EXECUTION_ENABLED === "true",
      liveTrading: process.env.LIVE_TRADING_ENABLED === "true",
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
