import { prisma } from "@augurium/database";
import {
  computeRetryDelayMs,
  getDiscordConfig,
  sendDiscordWebhook,
  type DiscordEventPayload,
} from "@augurium/discord";
import {
  discordChannelForEventType,
  resolveDiscordWebhookUrl,
} from "@augurium/shared";

export const LIVE_COPY_DISCORD_PREFIX = "copy:live:";

const BATCH_SIZE = Number(process.env.DISCORD_DISPATCH_BATCH ?? "20");
const MAX_RETRIES = Number(process.env.DISCORD_MAX_RETRIES ?? "5");

export function isLiveCopyOnlyDiscord(): boolean {
  return process.env.DISCORD_LIVE_COPY_ONLY === "true";
}

/** Drop shadow/signal backlog when only trade enter/exit/problem alerts are wanted. */
export async function skipNonLiveCopyDiscordBacklog(): Promise<number> {
  if (!isLiveCopyOnlyDiscord()) return 0;
  const result = await prisma.discordEvent.updateMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      OR: [
        { dedupeKey: null },
        { NOT: { dedupeKey: { startsWith: LIVE_COPY_DISCORD_PREFIX } } },
      ],
    },
    data: {
      status: "SKIPPED",
      errorMessage: "DISCORD_LIVE_COPY_ONLY — trade enter/exit/problem alerts only",
    },
  });
  if (result.count > 0) {
    console.log(`[discord] skipped ${result.count} non-trade pending alert(s)`);
  }
  return result.count;
}

export async function dispatchLiveCopyDiscordEvents(): Promise<number> {
  const config = getDiscordConfig(process.env);
  if (!config.canSend) return 0;

  const now = new Date();
  const events = await prisma.discordEvent.findMany({
    where: {
      OR: [
        { dedupeKey: { startsWith: LIVE_COPY_DISCORD_PREFIX } },
        { dedupeKey: { startsWith: "portfolio:health:" } },
        { dedupeKey: { startsWith: "brain:" } },
        { dedupeKey: { startsWith: "journal:" } },
        { dedupeKey: { startsWith: "copy:weekly-stop:" } },
        { dedupeKey: { startsWith: "ops:" } },
        {
          eventType: {
            in: [
              "PORTFOLIO_HEALTH",
              "RISK_ALERT",
              "COPY_WEEKLY_STOP",
              "BRAIN_UPDATE",
              "JOURNAL_ENTRY",
              "WORKER_ONLINE",
              "SCAN_COMPLETE",
              "FUNNEL_WARNING",
              "DB_PRESSURE_WARNING",
            ],
          },
        },
      ],
      AND: [
        {
          OR: [
            { status: "PENDING" },
            {
              status: "FAILED",
              retryCount: { lt: MAX_RETRIES },
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
            },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  for (const ev of events) {
    const payload = ev.payload as unknown as DiscordEventPayload;
    const result = await sendDiscordWebhook(config, payload, fetch, {
      eventType: ev.eventType,
    });

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
  }

  return sent;
}
