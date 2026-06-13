import { prisma } from "@augurium/database";
import { buildLiveCopyTradeEmbed, getDiscordConfig } from "@augurium/discord";
import { queueDiscordEvent } from "./discord-events.js";
import { dispatchDiscordEvents } from "../engines/discord.js";

export async function notifyLiveCopyTrade(input: {
  kind: "submitted" | "blocked" | "closed";
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

  const eventType =
    input.kind === "submitted"
      ? "EXECUTION_LIVE"
      : input.kind === "blocked"
        ? "EXECUTION_BLOCKED"
        : "COPY_LIVE_CLOSED";

  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey: `copy:live:${input.kind}:${input.mirrorId}` },
    select: { status: true },
  });
  if (existing?.status === "SENT") {
    return "already_sent";
  }

  const status = await queueDiscordEvent({
    eventType,
    dedupeKey: `copy:live:${input.kind}:${input.mirrorId}`,
    title: `Live copy ${input.kind}: ${input.marketTitle.slice(0, 48)}`,
    payload: buildLiveCopyTradeEmbed({
      ...input,
      dashboardUrl: `${config.dashboardBaseUrl}/copy`,
    }),
  });

  if (status === "PENDING") {
    const sent = await dispatchDiscordEvents();
    console.log(
      `[discord] live copy ${input.kind} mirror=${input.mirrorId} trader=${input.traderAddress.slice(0, 10)} immediateDispatchSent=${sent}`,
    );
    return "queued";
  }

  return "skipped";
}

/** On boot: alert Discord for COPY whitelist live positions already on Polymarket US. */
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

  const mirrors = await prisma.copyLiveMirror.findMany({
    where: { status: { in: ["SUBMITTED", "OPEN"] } },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true } },
    },
    orderBy: { submittedAt: "desc" },
  });

  let queued = 0;
  let alreadySent = 0;
  for (const m of mirrors) {
    const result = await notifyLiveCopyTrade({
      kind: "submitted",
      mirrorId: m.id,
      marketTitle: m.market.title,
      side: m.side,
      sizeUsd: m.requestedSizeUsd,
      entryPrice: m.entryPrice,
      traderAddress: m.trader.address,
      providerOrderId: m.providerOrderId,
    });
    if (result === "queued") queued++;
    else if (result === "already_sent") alreadySent++;
  }

  const flushed = await dispatchDiscordEvents();
  console.log(
    `[discord] startup COPY whitelist backfill open=${mirrors.length} queued=${queued} alreadySent=${alreadySent} flushed=${flushed}`,
  );
}
