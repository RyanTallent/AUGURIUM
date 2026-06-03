import { getDiscordConfig } from "@augurium/shared";
import { prisma } from "@augurium/database";
import { getScoringHealthMetrics, scoringWarningMessage } from "./scoring-health";

export interface DiscordOpsStatus {
  enabled: boolean;
  webhookConfigured: boolean;
  canSend: boolean;
  lastDispatchStatus: string | null;
  lastSkippedReason: string | null;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function getDiscordOpsStatus(): Promise<DiscordOpsStatus> {
  const config = getDiscordConfig(process.env);

  let lastDispatchStatus: string | null = null;
  let lastSkippedReason: string | null = null;
  let pending = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const [lastEvent, grouped] = await Promise.all([
      prisma.discordEvent.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.discordEvent.groupBy({ by: ["status"], _count: true }),
    ]);

    if (lastEvent) {
      lastDispatchStatus = lastEvent.status;
      if (lastEvent.status === "SKIPPED") {
        lastSkippedReason = lastEvent.errorMessage;
      }
    }

    for (const row of grouped) {
      if (row.status === "PENDING") pending = row._count;
      if (row.status === "SENT") sent = row._count;
      if (row.status === "SKIPPED") skipped = row._count;
      if (row.status === "FAILED") failed = row._count;
    }
  } catch {
    /* DB offline */
  }

  return {
    enabled: config.enabled,
    webhookConfigured: config.webhookUrl.length > 0,
    canSend: config.canSend,
    lastDispatchStatus,
    lastSkippedReason,
    pending,
    sent,
    skipped,
    failed,
  };
}

export interface ProductionWarnings {
  messages: string[];
}

export async function getProductionWarnings(): Promise<ProductionWarnings> {
  const messages: string[] = [];
  const discord = await getDiscordOpsStatus();

  if (!discord.canSend) {
    messages.push(
      "Discord is disabled on this host. Set DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL in the Render Environment Group (augurium-shared).",
    );
  }

  try {
    const [marketTotal, categorized, scoring, shadowTotal, shadowFresh, tradeNow] =
      await Promise.all([
        prisma.market.count(),
        prisma.market.count({
          where: {
            AND: [
              { category: { not: null } },
              { category: { notIn: ["", "Other", "uncategorized"] } },
            ],
          },
        }),
        getScoringHealthMetrics(),
        prisma.shadowTrade.count(),
        prisma.shadowTrade.count({ where: { priceStatus: "FRESH" } }),
        prisma.signal.count({ where: { status: "active", signalType: "TRADE_NOW" } }),
      ]);

    const categoryPct = marketTotal > 0 ? (categorized / marketTotal) * 100 : 0;
    if (categoryPct < 40) {
      messages.push(
        `Category coverage is low (${categoryPct.toFixed(0)}%). Run scripts/backfill-categories.mjs on the worker.`,
      );
    }

    const scoreWarn = scoringWarningMessage(scoring);
    if (scoreWarn) messages.push(scoreWarn);

    if (shadowTotal > 0) {
      const freshPct = (shadowFresh / shadowTotal) * 100;
      const latestShadowRun = await prisma.ingestionRun.findFirst({
        where: { source: "shadow-portfolio", finishedAt: { not: null } },
        orderBy: { finishedAt: "desc" },
      });
      const meta =
        latestShadowRun?.metadata && typeof latestShadowRun.metadata === "object"
          ? (latestShadowRun.metadata as Record<string, unknown>)
          : null;
      const partialTimeout = meta?.timedOut === true && (meta?.processed as number) > 0;
      if (freshPct < 25 && !partialTimeout) {
        messages.push(
          `Shadow prices are mostly stale (${freshPct.toFixed(0)}% FRESH). Ensure shadow:sync runs after trade ingest.`,
        );
      }
    }

    if (tradeNow === 0) {
      messages.push(
        "No TRADE_NOW signals — strict gates (consensus≥85, alpha≥80, multi-trader evidence) block promotion; weak data also downgrades to RESEARCH.",
      );
    }
  } catch {
    messages.push("Database unreachable — check DATABASE_URL on Render.");
  }

  return { messages };
}
