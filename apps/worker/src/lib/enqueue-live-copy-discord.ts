import { prisma } from "@augurium/database";
import {
  buildLiveCopyTradeEmbed,
  buildRiskAlertEmbed,
  buildBrainUpdateEmbed,
  buildJournalEntryEmbed,
  getDiscordConfig,
} from "@augurium/discord";
import { isRoutineCopySkipReason } from "@augurium/copy-trading";
import { queueDiscordEvent } from "./discord-events.js";
import {
  dispatchLiveCopyDiscordEvents,
  skipNonLiveCopyDiscordBacklog,
} from "./discord-live-copy-dispatch.js";

/** Routine scan blocks — dashboard only, not Discord. */
export function isSilentLiveCopyBlockReason(reason: string | null | undefined): boolean {
  return isRoutineCopySkipReason(reason);
}

export async function notifyLiveCopyTrade(input: {
  kind: "filled" | "blocked" | "closed" | "partial";
  mirrorId: string;
  marketTitle: string;
  side: string;
  sizeUsd: number;
  entryPrice: number;
  traderAddress: string;
  providerOrderId?: string | null;
  blockReason?: string | null;
  ladderRung?: 1 | 2;
  tier?: string | null;
  conviction?: number | null;
  lifetime?: number | null;
  heat?: number | null;
  confidence?: number | null;
  uncertainty?: number | null;
  usMatchPct?: number | null;
  usMarketSlug?: string | null;
  realizedPnlUsd?: number | null;
  reason?: string | null;
}): Promise<"queued" | "skipped" | "already_sent"> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) {
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
        : input.kind === "partial"
          ? "COPY_LIVE_PARTIAL"
          : "COPY_LIVE_CLOSED";

  const dedupeKey =
    input.kind === "partial"
      ? `copy:live:partial:${input.mirrorId}:rung${input.ladderRung ?? 0}`
      : `copy:live:${input.kind}:${input.mirrorId}`;

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
        : input.kind === "partial"
          ? `PARTIAL EXIT (rung ${input.ladderRung ?? "?"}): ${input.marketTitle.slice(0, 40)}`
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
      `[discord] ${input.kind === "filled" ? "TRADE ENTER" : input.kind === "partial" ? "PARTIAL EXIT" : input.kind === "closed" ? "TRADE EXIT" : "TRADE PROBLEM"} mirror=${input.mirrorId} trader=${input.traderAddress.slice(0, 10)} sent=${sent}`,
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

export async function notifyWeeklyStopRisk(input: {
  weekKey: string;
  message: string;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return;

  const dedupeKey = `copy:weekly-stop:${input.weekKey}`;
  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey },
    select: { status: true },
  });
  if (existing && existing.status === "SENT") return;

  const status = await queueDiscordEvent({
    eventType: "COPY_WEEKLY_STOP",
    dedupeKey,
    title: `RISK: Weekly stop — ${input.weekKey}`,
    payload: buildRiskAlertEmbed({
      title: "Weekly 20% stop — no new entries",
      message: input.message,
      source: "copy:live",
    }),
  });

  if (status === "PENDING") {
    await dispatchLiveCopyDiscordEvents();
  }
}

export async function notifyBrainLeaderChange(input: {
  promoted: string[];
  cooled: string[];
  copyEnabled: number;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return;
  if (input.promoted.length === 0 && input.cooled.length === 0) return;

  const dayKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = `brain:leaders:${dayKey}:${input.promoted.length}:${input.cooled.length}`;
  const fmt = (w: string) => `\`${w.slice(0, 6)}…${w.slice(-4)}\``;

  const status = await queueDiscordEvent({
    eventType: "BRAIN_UPDATE",
    dedupeKey,
    title: "AUGURIUM brain — leader allocation",
    payload: buildBrainUpdateEmbed({
      title: "Leader promotions / cooling",
      message: `${input.copyEnabled} active COPY leaders after v1 gates.`,
      fields: [
        {
          name: "Promoted",
          value: input.promoted.length ? input.promoted.slice(0, 8).map(fmt).join(", ") : "—",
        },
        {
          name: "Cooled",
          value: input.cooled.length ? input.cooled.slice(0, 8).map(fmt).join(", ") : "—",
        },
      ],
      dashboardUrl: `${config.dashboardBaseUrl}/copy`,
    }),
  });

  if (status === "PENDING") {
    await dispatchLiveCopyDiscordEvents();
  }
}

export async function notifyJournalDecision(input: {
  key: string;
  title: string;
  decision: string;
  context: string;
}): Promise<void> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return;

  const status = await queueDiscordEvent({
    eventType: "JOURNAL_ENTRY",
    dedupeKey: `journal:${input.key}`,
    title: input.title.slice(0, 120),
    payload: buildJournalEntryEmbed({
      title: input.title,
      decision: input.decision,
      context: input.context,
      dashboardUrl: `${config.dashboardBaseUrl}/copy`,
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
      "[discord] no alerts until DISCORD_ENABLED=true and channel webhooks are set",
    );
    return;
  }

  const skipped = await skipNonLiveCopyDiscordBacklog();
  console.log(
    `[discord] startup — ENTER alerts only on new verified fills (skipped ${skipped} non-trade backlog)`,
  );
}
