import { prisma } from "@augurium/database";
import {
  getDiscordConfig,
  type DiscordEventPayload,
  type DiscordEventType,
} from "@augurium/discord";

export async function queueDiscordEvent(input: {
  eventType: DiscordEventType;
  dedupeKey: string;
  title: string;
  payload: DiscordEventPayload;
}): Promise<"PENDING" | "SKIPPED"> {
  const config = getDiscordConfig(process.env);

  const existing = await prisma.discordEvent.findUnique({
    where: { dedupeKey: input.dedupeKey },
  });
  if (existing) return existing.status === "SKIPPED" ? "SKIPPED" : "PENDING";

  const status = config.canSend ? "PENDING" : "SKIPPED";
  const errorMessage = config.canSend
    ? null
    : !config.enabled
      ? "DISCORD_ENABLED is false — set DISCORD_ENABLED=true in Render Environment Group (augurium-shared)"
      : "DISCORD_WEBHOOK_URL missing — add webhook secret to Render Environment Group (augurium-shared)";

  if (!config.canSend) {
    console.warn(`[discord] Skipped event ${input.dedupeKey}: ${errorMessage}`);
  }

  await prisma.discordEvent.create({
    data: {
      eventType: input.eventType,
      dedupeKey: input.dedupeKey,
      title: input.title,
      payload: input.payload as object,
      status,
      errorMessage,
    },
  });

  return status;
}
