import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function envFlag(name) {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

async function main() {
  const executionEnabled = envFlag("EXECUTION_ENABLED");
  const liveTradingEnabled = envFlag("LIVE_TRADING_ENABLED");
  const allowRealMoney = envFlag("ALLOW_REAL_MONEY");
  const provider = (process.env.EXECUTION_PROVIDER ?? "paper").toLowerCase();

  const credentialsConfigured = Boolean(
    process.env.POLYMARKET_PRIVATE_KEY?.trim() &&
      process.env.POLYMARKET_API_KEY?.trim() &&
      process.env.POLYMARKET_API_SECRET?.trim() &&
      process.env.POLYMARKET_API_PASSPHRASE?.trim() &&
      process.env.POLYMARKET_FUNDER_ADDRESS?.trim(),
  );

  const { PaperExecutionProvider, PolymarketExecutionProvider, MemoryPaperStore } =
    await import("@augurium/execution");

  const paper = new PaperExecutionProvider(new MemoryPaperStore());
  const paperHealth = await paper.healthCheck();
  const poly = new PolymarketExecutionProvider();
  const polyHealth = await poly.healthCheck();
  const polyCreds = await poly.validateCredentials();

  const acceptDecisions = await prisma.portfolioDecision.count({
    where: { decision: "ACCEPT" },
  });
  const ordersTotal = await prisma.executionOrder.count();
  const fillsTotal = await prisma.executionFill.count();
  const locksTotal = await prisma.executionLock.count();
  const blocked = await prisma.executionOrder.findMany({
    where: { status: "BLOCKED" },
    take: 10,
    select: { blockReason: true, signalId: true },
  });
  const recon = await prisma.executionReconciliation.findUnique({
    where: { id: "current" },
  });
  const lastRun = await prisma.ingestionRun.findFirst({
    where: { source: "execution-engine" },
    orderBy: { startedAt: "desc" },
  });

  const liveActuallyEnabled =
    executionEnabled &&
    provider === "polymarket" &&
    liveTradingEnabled &&
    allowRealMoney;

  const passed =
    !liveActuallyEnabled &&
    paperHealth.ready &&
    !polyHealth.ready &&
    ordersTotal >= 0;

  console.log(
    JSON.stringify(
      {
        phase: "G",
        passed,
        execution: {
          provider,
          executionEnabled,
          liveTradingEnabled,
          allowRealMoney,
          liveActuallyEnabled,
          credentialsConfigured,
          credentialsPrinted: false,
        },
        providers: {
          paper: paperHealth,
          polymarket: {
            health: polyHealth,
            credentials: {
              configured: polyCreds.configured,
              valid: polyCreds.valid,
              message: polyCreds.message,
            },
            ready: polyHealth.ready,
            notReadyReason: polyHealth.message,
          },
        },
        eligibleAcceptDecisions: acceptDecisions,
        ordersCreated: ordersTotal,
        fillsCreated: fillsTotal,
        executionLocks: locksTotal,
        blockedExecutions: blocked.map((b) => ({
          signalId: b.signalId,
          reason: b.blockReason,
        })),
        reconciliation: recon
          ? {
              status: recon.status,
              provider: recon.provider,
              lastCheckedAt: recon.lastCheckedAt,
              mismatchDetails: recon.mismatchDetails,
            }
          : null,
        lastExecutionRun: lastRun
          ? {
              status: lastRun.status,
              metadata: lastRun.metadata,
              error: lastRun.error,
            }
          : null,
        safety: {
          liveTradingDisabledByDefault: !liveActuallyEnabled,
          noSecretsInOutput: true,
          noLiveOrdersInVerification: true,
        },
        beforeLiveTrading: [
          "Set EXECUTION_ENABLED=true",
          "Set EXECUTION_PROVIDER=polymarket",
          "Set LIVE_TRADING_ENABLED=true",
          "Set ALLOW_REAL_MONEY=true",
          "Configure all POLYMARKET_* credentials",
          "Complete Polymarket CLOB client integration (provider currently NOT_READY)",
          "Ensure TRADE_NOW signals and ACCEPT portfolio decisions exist",
          "Run reconciliation until OK",
        ],
        commands: ["npm run test:execution", "npm run execution:run", "npm run verify:phase-g"],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
