import { prisma } from "@augurium/database";
import {
  computeRetryDelayMs,
  getDiscordConfig,
  sendDiscordWebhook,
  type DiscordEventPayload,
} from "@augurium/discord";

const BATCH_SIZE = Number(process.env.DISCORD_DISPATCH_BATCH ?? "20");
const MAX_RETRIES = Number(process.env.DISCORD_MAX_RETRIES ?? "5");

export interface DiscordDispatchSummary {
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
}

export async function runDiscordDispatchJob(): Promise<DiscordDispatchSummary> {
  const config = getDiscordConfig(process.env);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let retried = 0;

  if (!config.canSend) {
    console.warn(
      "[discord] Dispatch skipped — set DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL",
    );
    const pending = await prisma.discordEvent.findMany({
      where: { status: "PENDING" },
      take: BATCH_SIZE,
    });
    for (const ev of pending) {
      await prisma.discordEvent.update({
        where: { id: ev.id },
        data: {
          status: "SKIPPED",
          errorMessage: config.enabled
            ? "DISCORD_WEBHOOK_URL missing"
            : "DISCORD_ENABLED is false",
        },
      });
      skipped++;
    }
    return { sent, failed, skipped, retried };
  }

  const now = new Date();
  const events = await prisma.discordEvent.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        {
          status: "FAILED",
          retryCount: { lt: MAX_RETRIES },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const ev of events) {
    const payload = ev.payload as unknown as DiscordEventPayload;
    const result = await sendDiscordWebhook(config, payload);

    if (result.status === "SENT") {
      await prisma.discordEvent.update({
        where: { id: ev.id },
        data: { status: "SENT", sentAt: new Date(), errorMessage: null },
      });
      sent++;
      continue;
    }

    if (result.status === "SKIPPED") {
      await prisma.discordEvent.update({
        where: { id: ev.id },
        data: { status: "SKIPPED", errorMessage: result.errorMessage },
      });
      skipped++;
      continue;
    }

    const retryCount = ev.retryCount + 1;
    const nextRetryAt = new Date(Date.now() + computeRetryDelayMs(retryCount));
    await prisma.discordEvent.update({
      where: { id: ev.id },
      data: {
        status: "FAILED",
        errorMessage: result.errorMessage,
        retryCount,
        nextRetryAt: retryCount < MAX_RETRIES ? nextRetryAt : null,
      },
    });
    failed++;
    retried++;
  }

  return { sent, failed, skipped, retried };
}
