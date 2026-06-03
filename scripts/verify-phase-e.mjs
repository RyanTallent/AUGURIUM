import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function envFlag(name) {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

async function main() {
  const discordEnabled = envFlag("DISCORD_ENABLED");
  const webhookConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());

  const total = await prisma.discordEvent.count();
  const byStatus = await prisma.discordEvent.groupBy({
    by: ["status"],
    _count: true,
  });
  const statusCounts = { PENDING: 0, SENT: 0, SKIPPED: 0, FAILED: 0 };
  for (const row of byStatus) {
    if (row.status in statusCounts) statusCounts[row.status] = row._count;
  }

  const latestSignal = await prisma.discordEvent.findFirst({
    where: { eventType: "SIGNAL_ALERT" },
    orderBy: { createdAt: "desc" },
  });
  const latestWeekly = await prisma.discordEvent.findFirst({
    where: { eventType: "WEEKLY_REPORT" },
    orderBy: { createdAt: "desc" },
  });
  const latestRisk = await prisma.discordEvent.findFirst({
    where: { eventType: "RISK_SYSTEM" },
    orderBy: { createdAt: "desc" },
  });
  const failures = await prisma.discordEvent.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const duplicates = await prisma.$queryRaw`
    SELECT "dedupeKey", COUNT(*)::int AS c FROM "DiscordEvent"
    WHERE "dedupeKey" IS NOT NULL
    GROUP BY "dedupeKey" HAVING COUNT(*) > 1
  `;

  const lastEnqueue = await prisma.ingestionRun.findFirst({
    where: { source: "discord-enqueue" },
    orderBy: { startedAt: "desc" },
  });

  const passed =
    total > 0 &&
    (statusCounts.SKIPPED > 0 || statusCounts.SENT > 0 || statusCounts.PENDING > 0) &&
    duplicates.length === 0;

  console.log(
    JSON.stringify(
      {
        phase: "E",
        passed,
        discord: {
          enabled: discordEnabled,
          webhookConfigured,
          canSend: discordEnabled && webhookConfigured,
        },
        counts: {
          totalDiscordEvents: total,
          ...statusCounts,
        },
        latestSignalAlert: latestSignal
          ? {
              title: latestSignal.title,
              status: latestSignal.status,
              createdAt: latestSignal.createdAt,
            }
          : null,
        latestWeeklyReport: latestWeekly
          ? {
              title: latestWeekly.title,
              status: latestWeekly.status,
              createdAt: latestWeekly.createdAt,
            }
          : null,
        latestRiskAlert: latestRisk
          ? {
              title: latestRisk.title,
              status: latestRisk.status,
              message: latestRisk.errorMessage,
            }
          : null,
        failures: failures.map((f) => ({
          title: f.title,
          eventType: f.eventType,
          errorMessage: f.errorMessage,
          retryCount: f.retryCount,
        })),
        duplicateDedupeKeys: duplicates,
        lastEnqueueRun: lastEnqueue,
        setup: {
          envExample:
            "DISCORD_ENABLED=true and DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...",
          commands: ["npm run discord:enqueue", "npm run discord:dispatch"],
        },
        safety: {
          liveExecution: false,
          alertsAreAdvisory: true,
        },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
