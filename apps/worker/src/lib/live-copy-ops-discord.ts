import { prisma } from "@augurium/database";
import { buildBrainUpdateEmbed, buildPortfolioEmbed, buildRiskAlertEmbed, getDiscordConfig } from "@augurium/discord";
import { getQueueIntervalMs } from "./queue-scheduler.js";
import { QUEUES } from "@augurium/shared";
import { queueDiscordEvent } from "./discord-events.js";
import { dispatchLiveCopyDiscordEvents } from "./discord-live-copy-dispatch.js";

async function sendOpsEvent(input: {
  eventType: import("@augurium/discord").DiscordEventType;
  dedupeKey: string;
  title: string;
  payload: ReturnType<typeof buildPortfolioEmbed>;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return;

  const status = await queueDiscordEvent({
    eventType: input.eventType,
    dedupeKey: input.dedupeKey,
    title: input.title,
    payload: input.payload,
  });
  if (status === "PENDING") {
    await dispatchLiveCopyDiscordEvents();
  }
}

export async function notifyWorkerOnline(input: {
  bankrollUsd: number | null;
  usReady: boolean;
}): Promise<void> {
  const scanSec = Math.round(getQueueIntervalMs(QUEUES.COPY_AUTO_PIPELINE) / 1000);
  const fields = [
    { name: "Execution", value: process.env.EXECUTION_PROVIDER ?? "unset", inline: true },
    {
      name: "Live copy",
      value: process.env.LIVE_COPY_ENABLED === "true" ? "enabled" : "disabled",
      inline: true,
    },
    { name: "US ready", value: input.usReady ? "true" : "false", inline: true },
    {
      name: "Bankroll",
      value: input.bankrollUsd != null ? `$${input.bankrollUsd.toFixed(2)}` : "—",
      inline: true,
    },
    { name: "Scan interval", value: `${scanSec}s`, inline: true },
    {
      name: "Leader tiers",
      value: "Rising Star / Established",
      inline: true,
    },
  ];
  const config = getDiscordConfig(process.env);
  await sendOpsEvent({
    eventType: "WORKER_ONLINE",
    dedupeKey: `ops:online:${new Date().toISOString().slice(0, 13)}`,
    title: "AUGURIUM ONLINE",
    payload: buildPortfolioEmbed({
      title: "AUGURIUM ONLINE",
      description: "Worker started — live US copy system armed.",
      fields,
      dashboardUrl: `${config.dashboardBaseUrl}/copy`,
    }),
  });
}

export async function notifyScanComplete(input: {
  runId: string;
  walletsScanned: number;
  copyEnabled: number;
  leadersByCategory: Record<string, number>;
  submitted: number;
  topFails: Array<{ reason: string; count: number }>;
  sourcePositions: number;
  noTradeReason: string | null;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  const catLine =
    Object.keys(input.leadersByCategory).length > 0
      ? Object.entries(input.leadersByCategory)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "—";
  const failsLine =
    input.topFails.length > 0
      ? input.topFails
          .slice(0, 4)
          .map((f) => `${f.count}× ${f.reason}`)
          .join(" | ")
      : "—";

  await sendOpsEvent({
    eventType: "SCAN_COMPLETE",
    dedupeKey: `ops:scan:${input.runId}`,
    title: "SCAN COMPLETE",
    payload: buildPortfolioEmbed({
      title: "SCAN COMPLETE",
      description: "Copy auto-pipeline cycle finished.",
      fields: [
        { name: "Wallets scanned", value: String(input.walletsScanned), inline: true },
        { name: "COPY enabled", value: String(input.copyEnabled), inline: true },
        { name: "Submitted", value: String(input.submitted), inline: true },
        { name: "Source positions", value: String(input.sourcePositions), inline: true },
        { name: "Leaders by category", value: catLine },
        { name: "topFails", value: failsLine },
        ...(input.noTradeReason
          ? [{ name: "Why no trades", value: input.noTradeReason }]
          : []),
      ],
      dashboardUrl: `${config.dashboardBaseUrl}/api/copy/live-status`,
    }),
  });
}

export async function notifyFunnelWarning(input: {
  streak: number;
  topFails: Array<{ reason: string; count: number }>;
  nextAction: string;
  variant?: "no-leaders" | "no-positions";
  copyEnabled?: number;
  sourcePositions?: number;
}): Promise<void> {
  const hourKey = new Date().toISOString().slice(0, 13);
  const failsLine = input.topFails
    .slice(0, 3)
    .map((f) => `${f.count}× ${f.reason}`)
    .join(" | ");
  const variant = input.variant ?? "no-leaders";
  const message =
    variant === "no-positions"
      ? `copyEnabled=${input.copyEnabled ?? "?"} but sourcePositions=0 for ${input.streak} consecutive cycles.`
      : `copyEnabled=0 for ${input.streak} consecutive pipeline cycles.`;

  await sendOpsEvent({
    eventType: "FUNNEL_WARNING",
    dedupeKey: `ops:funnel-warn:${variant}:${hourKey}`,
    title: "FUNNEL WARNING",
    payload: buildBrainUpdateEmbed({
      title: "FUNNEL WARNING",
      message,
      fields: [
        { name: "Dominant blocker", value: failsLine || "no US-tradeable leader positions" },
        { name: "Next action", value: input.nextAction },
      ],
      dashboardUrl: `${getDiscordConfig(process.env).dashboardBaseUrl}/api/copy/live-status`,
    }),
  });
}

export async function notifyDbPressureWarning(input: {
  runId?: string;
  step?: string;
  message: string;
}): Promise<void> {
  const hourKey = new Date().toISOString().slice(0, 13);
  await sendOpsEvent({
    eventType: "DB_PRESSURE_WARNING",
    dedupeKey: `ops:db-pressure:${hourKey}`,
    title: "DB PRESSURE WARNING",
    payload: buildRiskAlertEmbed({
      title: "DB PRESSURE WARNING",
      message: input.step
        ? `${input.step}: ${input.message}`
        : input.message,
      source: "copy:auto-pipeline",
    }),
  });
}

export async function notifyNoEligibleLeaders(input: {
  copyEnabled: number;
  usEvaluated: number;
  skippedZeroUsOverlap: number;
}): Promise<void> {
  if (input.copyEnabled > 0) return;
  const dayKey = new Date().toISOString().slice(0, 10);
  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey: `ops:no-leaders:${dayKey}` },
    select: { status: true },
  });
  if (existing?.status === "SENT") return;

  await sendOpsEvent({
    eventType: "BRAIN_UPDATE",
    dedupeKey: `ops:no-leaders:${dayKey}`,
    title: "No eligible leaders",
    payload: buildBrainUpdateEmbed({
      title: "Live system scanning — no eligible leaders",
      message:
        "Live system is scanning US wallets, but no leaders currently pass Rising Star / Established tier gates.",
      fields: [
        { name: "Wallets evaluated", value: String(input.usEvaluated), inline: true },
        {
          name: "Tier failures",
          value: String(input.skippedZeroUsOverlap),
          inline: true,
        },
      ],
      dashboardUrl: `${getDiscordConfig(process.env).dashboardBaseUrl}/copy`,
    }),
  });
}

export async function notifyPipelineRisk(input: {
  runId: string;
  message: string;
}): Promise<void> {
  await sendOpsEvent({
    eventType: "RISK_ALERT",
    dedupeKey: `ops:pipeline-risk:${input.runId}`,
    title: `Pipeline risk: ${input.message.slice(0, 60)}`,
    payload: buildRiskAlertEmbed({
      title: "Copy pipeline degraded",
      message: input.message,
      source: "copy:auto-pipeline",
    }),
  });
}
