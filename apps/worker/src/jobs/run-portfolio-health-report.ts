import { prisma } from "@augurium/database";
import {
  evaluateCopyWeeklyStopLoss,
  getLiveCopySizingConfig,
  sumOpenExposureUsd,
} from "@augurium/copy-trading";
import { getExecutionConfig, isPolymarketUsReady } from "@augurium/execution";
import { buildPortfolioEmbed, getDiscordConfig, sendDiscordWebhook } from "@augurium/discord";
import { queueDiscordEvent } from "../lib/discord-events.js";
import { resolveLiveCopyBankroll } from "../lib/resolve-live-copy-bankroll.js";

export async function runPortfolioHealthReportJob(): Promise<"sent" | "skipped"> {
  const config = getDiscordConfig(process.env);
  if (!config.enabled) return "skipped";

  const dayKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = `portfolio:health:daily:${dayKey}`;
  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey },
    select: { status: true },
  });
  if (existing && existing.status === "SENT") return "skipped";

  const cfg = getExecutionConfig();
  const bankroll = await resolveLiveCopyBankroll();
  const weekly = await evaluateCopyWeeklyStopLoss(bankroll.bankrollUsd);
  const sizing = getLiveCopySizingConfig();

  const mirrors = await prisma.copyLiveMirror.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
    select: { status: true, requestedSizeUsd: true },
  });
  const deployed = sumOpenExposureUsd(mirrors.map((m) => ({ usd: m.requestedSizeUsd })));
  const openCount = mirrors.filter((m) => m.status === "OPEN").length;
  const pendingCount = mirrors.filter((m) => m.status === "PENDING").length;

  const copyEnabled = await prisma.copyTraderControl.count({ where: { enabled: true } });
  const usCatalog = await prisma.market.count({ where: { source: "polymarket-us", active: true } });

  const message = [
    `Bankroll: $${bankroll.bankrollUsd.toFixed(2)} (${bankroll.source})`,
    `Deployed: $${deployed.toFixed(2)} / ${(sizing.maxDeployedPct * 100).toFixed(0)}% cap`,
    `Open mirrors: ${openCount} · pending: ${pendingCount}`,
    `COPY leaders enabled: ${copyEnabled}`,
    `Weekly PnL: $${weekly.totalPnlUsd.toFixed(2)} (${(weekly.lossPct * 100).toFixed(1)}% loss)`,
    `Weekly halt: ${weekly.halted ? weekly.haltedReason ?? "yes" : "no"}`,
    `US catalog markets: ${usCatalog}`,
    `Provider: ${cfg.provider} · US ready: ${isPolymarketUsReady()}`,
  ].join("\n");

  const payload = buildPortfolioEmbed({
    title: `Portfolio health — ${dayKey}`,
    description: "Daily live copy portfolio snapshot.",
    fields: message.split("\n").map((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return { name: "Note", value: line };
      return { name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), inline: true };
    }),
    dashboardUrl: `${config.dashboardBaseUrl}/copy`,
  });

  if (config.canSend) {
    const result = await sendDiscordWebhook(config, payload, fetch, {
      eventType: "PORTFOLIO_HEALTH",
    });
    if (result.status === "SENT") {
      await prisma.discordEvent.upsert({
        where: { dedupeKey },
        create: {
          eventType: "PORTFOLIO_HEALTH",
          dedupeKey,
          title: `Portfolio health — ${dayKey}`,
          payload: payload as object,
          status: "SENT",
          sentAt: new Date(),
        },
        update: { status: "SENT", sentAt: new Date(), errorMessage: null },
      });
      console.log(`[portfolio-health] sent daily report ${dayKey}`);
      return "sent";
    }
  }

  const status = await queueDiscordEvent({
    eventType: "PORTFOLIO_HEALTH",
    dedupeKey,
    title: `Portfolio health — ${dayKey}`,
    payload,
  });
  return status === "PENDING" ? "sent" : "skipped";
}
