import { prisma } from "@augurium/database";
import { buildLiveCopyTradeEmbed, buildRiskAlertEmbed, getDiscordConfig } from "@augurium/discord";
import { queueDiscordEvent } from "./discord-events.js";
import {
  dispatchLiveCopyDiscordEvents,
  skipNonLiveCopyDiscordBacklog,
} from "./discord-live-copy-dispatch.js";

/** Routine scan blocks — dashboard only, not Discord. */
export function isSilentLiveCopyBlockReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes("late copy") ||
    r.includes("exposure would exceed") ||
    r.includes("no deploy room") ||
    r.includes("insufficient buying power")
  );
}

export async function notifyLiveCopyTrade(input: {
  kind: "filled" | "blocked" | "closed";
  mirrorId: string;
  marketTitle: string;
  side: string;
  sizeUsd: number;
  entryPrice: number;
  traderAddress: string;
  providerOrderId?: string | null;
  blockReason?: string | null;
}): Promise<"queued" | "skipped" | "already_sent"> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) {
    console.warn("[discord] live copy notification skipped — Discord not configured");
    return "skipped";
  }

  if (input.kind === "blocked" && isSilentLiveCopyBlockReason(input.blockReason)) {
    return "skipped";
  }

  const eventType =
    input.kind === "filled"
      ? "EXECUTION_LIVE"
      : input.kind === "blocked"
        ? "EXECUTION_BLOCKED"
        : "COPY_LIVE_CLOSED";

  const dedupeKey = `copy:live:${input.kind}:${input.mirrorId}`;

  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey },
    select: { status: true },
  });
  if (existing && existing.status !== "SKIPPED") {
    return "already_sent";
  }

  const status = await queueDiscordEvent({
    eventType,
    dedupeKey,
    title:
      input.kind === "filled"
        ? `TRADE ENTER: ${input.marketTitle.slice(0, 48)}`
        : input.kind === "closed"
          ? `TRADE EXIT: ${input.marketTitle.slice(0, 48)}`
          : `TRADE PROBLEM: ${input.marketTitle.slice(0, 48)}`,
    payload: buildLiveCopyTradeEmbed({
      ...input,
      dashboardUrl: `${config.dashboardBaseUrl}/copy`,
    }),
  });

  if (status === "PENDING") {
    const sent = await dispatchLiveCopyDiscordEvents();
    console.log(
      `[discord] ${input.kind === "filled" ? "TRADE ENTER" : input.kind === "closed" ? "TRADE EXIT" : "TRADE PROBLEM"} mirror=${input.mirrorId} trader=${input.traderAddress.slice(0, 10)} sent=${sent}`,
    );
    return "queued";
  }

  return "skipped";
}

export async function notifyLiveCopyProblem(input: {
  key: string;
  message: string;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return;

  const status = await queueDiscordEvent({
    eventType: "EXECUTION_ERROR",
    dedupeKey: `copy:live:problem:${input.key}`,
    title: `TRADE PROBLEM: ${input.message.slice(0, 80)}`,
    payload: buildRiskAlertEmbed({
      title: "TRADE PROBLEM",
      message: input.message,
      source: "copy:auto-pipeline",
    }),
  });

  if (status === "PENDING") {
    await dispatchLiveCopyDiscordEvents();
  }
}

/** Startup: configure Discord and clear non-trade backlog — no ENTER re-alerts on redeploy. */
export async function ensureLiveCopyDiscordOnStartup(): Promise<void> {
  const config = getDiscordConfig(process.env);
  console.log(
    `[discord] live COPY alerts enabled=${config.enabled} webhook=${config.webhookUrl ? "configured" : "MISSING"} canSend=${config.canSend}`,
  );
  if (!config.canSend) {
    console.warn(
      "[discord] no alerts until DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL are set in augurium-shared",
    );
    return;
  }

  const skipped = await skipNonLiveCopyDiscordBacklog();
  console.log(
    `[discord] startup — ENTER alerts only on new verified fills (skipped ${skipped} non-trade backlog)`,
  );
}
