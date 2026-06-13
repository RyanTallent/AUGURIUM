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
}): Promise<"queued" | "skipped"> {
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
      `[discord] live copy ${input.kind} mirror=${input.mirrorId} immediateDispatchSent=${sent}`,
    );
    return "queued";
  }

  return "skipped";
}
