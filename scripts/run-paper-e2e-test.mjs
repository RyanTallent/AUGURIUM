/**
 * Phase G — controlled paper execution E2E validation (not production).
 * Usage:
 *   npm run paper:e2e
 *   npm run paper:e2e -- --cleanup
 */
import { PrismaClient } from "@prisma/client";
import {
  getExecutionConfig,
  idempotencyKeyForSignal,
  isLivePolymarketEnabled,
  executionModeLabel,
} from "@augurium/execution";

const prisma = new PrismaClient();

const E2E_TAG = "TEST ONLY — Paper Execution E2E";
const MARKET_EXTERNAL_ID = "augurium:test-paper-e2e";
function applyPaperEnv() {
  process.env.EXECUTION_ENABLED = "true";
  process.env.EXECUTION_PROVIDER = "paper";
  process.env.LIVE_TRADING_ENABLED = "false";
  process.env.ALLOW_REAL_MONEY = "false";
}

async function cleanupTestArtifacts() {
  const testSignals = await prisma.signal.findMany({
    where: { reasoning: { contains: E2E_TAG } },
    select: { id: true },
  });
  const signalIds = testSignals.map((s) => s.id);

  const testMarkets = await prisma.market.findMany({
    where: {
      OR: [
        { externalId: MARKET_EXTERNAL_ID },
        { title: { contains: "[TEST ONLY]" } },
      ],
    },
    select: { id: true },
  });
  const marketIds = testMarkets.map((m) => m.id);

  if (signalIds.length > 0) {
    await prisma.executionFill.deleteMany({
      where: { order: { signalId: { in: signalIds } } },
    });
    await prisma.executionOrder.deleteMany({ where: { signalId: { in: signalIds } } });
    await prisma.executionPosition.deleteMany({
      where: { OR: [{ signalId: { in: signalIds } }, { marketId: { in: marketIds } }] },
    });
    await prisma.portfolioDecision.deleteMany({ where: { signalId: { in: signalIds } } });
    await prisma.replaySnapshot.deleteMany({ where: { signalId: { in: signalIds } } });
    for (const id of signalIds) {
      await prisma.discordEvent.deleteMany({
        where: { dedupeKey: { contains: id } },
      });
    }
    await prisma.executionAuditLog.deleteMany({
      where: { message: { contains: "paper-" } },
    });
    await prisma.signal.deleteMany({ where: { id: { in: signalIds } } });
  }

  if (marketIds.length > 0) {
    await prisma.market.deleteMany({ where: { id: { in: marketIds } } });
  }

  await prisma.executionLock.deleteMany({
    where: { lockKey: { contains: "lock:signal:" } },
  });

  return { signalsRemoved: signalIds.length, marketsRemoved: marketIds.length };
}

async function ensurePortfolioState() {
  const existing = await prisma.portfolioState.findUnique({ where: { id: "current" } });
  if (existing) return existing;
  return prisma.portfolioState.create({
    data: {
      id: "current",
      accountValue: 70,
      tradingBankroll: 70,
      reserveCapital: 0,
      deployedCapital: 0,
      availableCapital: 70,
      highWaterMark: 70,
    },
  });
}

async function seedPrimaryFixture() {
  const market = await prisma.market.upsert({
    where: { externalId: MARKET_EXTERNAL_ID },
    create: {
      externalId: MARKET_EXTERNAL_ID,
      conditionId: "test-condition-paper-e2e",
      title: "[TEST ONLY] Paper Execution E2E",
      category: "test",
      active: true,
      closed: false,
      marketQualityScore: 90,
    },
    update: {
      title: "[TEST ONLY] Paper Execution E2E",
      active: true,
      closed: false,
      marketQualityScore: 90,
    },
  });

  const signal = await prisma.signal.create({
    data: {
      marketId: market.id,
      conditionId: market.conditionId,
      side: "YES",
      outcome: "Yes",
      signalType: "TRADE_NOW",
      consensusScore: 95,
      alphaScore: 95,
      marketQualityScore: 90,
      systemConfidenceScore: 90,
      copyabilityScore: 80,
      informationEdgeScore: 70,
      convictionScore: 90,
      disagreementScore: 0.05,
      reasoning: `${E2E_TAG} — primary TRADE_NOW fixture for paper validation.`,
      rationale: E2E_TAG,
      status: "active",
      triggerTraderWallets: ["0xtest0000000000000000000000000000000001"],
    },
  });

  const decision = await prisma.portfolioDecision.create({
    data: {
      signalId: signal.id,
      marketId: market.id,
      decision: "ACCEPT",
      compositeScore: 93,
      riskScore: 15,
      recommendedSizeUsd: 7,
      recommendedPct: 0.1,
      reasons: [E2E_TAG, "E2E test ACCEPT decision"],
    },
  });

  const traderId = await ensureTestTrader();
  await prisma.trade.upsert({
    where: { externalKey: `test-e2e-trade-${market.id}` },
    create: {
      externalKey: `test-e2e-trade-${market.id}`,
      traderId,
      marketId: market.id,
      conditionId: market.conditionId ?? "test-condition-paper-e2e",
      transactionHash: `0xteste2e${market.id.slice(0, 8)}`,
      asset: "test-asset-e2e",
      side: "BUY",
      outcome: "Yes",
      size: 100,
      price: 0.55,
      tradedAt: new Date(),
      source: "paper-e2e-test",
    },
    update: { price: 0.55, tradedAt: new Date() },
  });

  return { market, signal, decision };
}

async function ensureTestTrader() {
  const address = "0xtest0000000000000000000000000000000001";
  const t = await prisma.trader.upsert({
    where: { address },
    create: { address, label: "E2E Test Trader", discoveredVia: "paper-e2e-test" },
    update: {},
  });
  return t.id;
}

async function seedConflictFixture(marketId, conditionId) {
  const signal = await prisma.signal.create({
    data: {
      marketId,
      conditionId,
      side: "NO",
      outcome: "No",
      signalType: "TRADE_NOW",
      consensusScore: 95,
      alphaScore: 95,
      marketQualityScore: 90,
      systemConfidenceScore: 90,
      reasoning: `${E2E_TAG} — opposite-side conflict probe (NO).`,
      rationale: E2E_TAG,
      status: "active",
    },
  });

  const decision = await prisma.portfolioDecision.create({
    data: {
      signalId: signal.id,
      marketId,
      decision: "ACCEPT",
      compositeScore: 93,
      riskScore: 15,
      recommendedSizeUsd: 5,
      recommendedPct: 0.07,
      reasons: [E2E_TAG, "conflict test ACCEPT"],
    },
  });

  return { signal, decision };
}

async function runEngine() {
  const { runExecutionEngineJob } = await import(
    "../apps/worker/src/jobs/run-execution-engine.ts"
  );
  return runExecutionEngineJob();
}

async function verifyNoPolymarketArtifacts(signalId) {
  const orders = await prisma.executionOrder.findMany({
    where: { signalId },
  });
  const polyOrders = orders.filter((o) => o.provider === "polymarket");
  const liveOrders = orders.filter((o) => o.mode === "LIVE");
  return {
    ok: polyOrders.length === 0 && liveOrders.length === 0,
    providers: [...new Set(orders.map((o) => o.provider))],
    modes: [...new Set(orders.map((o) => o.mode))],
  };
}

async function main() {
  const cleanupOnly = process.argv.includes("--cleanup");

  if (cleanupOnly) {
    const removed = await cleanupTestArtifacts();
    console.log(JSON.stringify({ cleanup: true, removed, passed: true }, null, 2));
    return;
  }

  applyPaperEnv();

  await cleanupTestArtifacts();
  await ensurePortfolioState();
  const { market, signal, decision } = await seedPrimaryFixture();

  const cfg = getExecutionConfig();
  const run1 = await runEngine();

  const idemKey = idempotencyKeyForSignal(signal.id);
  const order = await prisma.executionOrder.findUnique({ where: { idempotencyKey: idemKey } });
  const fills = order
    ? await prisma.executionFill.findMany({ where: { orderId: order.id } })
    : [];
  const position = await prisma.executionPosition.findFirst({
    where: { signalId: signal.id, status: "OPEN" },
  });
  const recon = await prisma.executionReconciliation.findUnique({ where: { id: "current" } });

  const discordEvent = await prisma.discordEvent.findFirst({
    where: {
      eventType: "EXECUTION_PAPER",
      dedupeKey: `execution:PAPER:EXECUTION_FILLED:${signal.id}`,
    },
  });

  const run2 = await runEngine();
  const orderCountAfterDup = await prisma.executionOrder.count({
    where: { signalId: signal.id },
  });

  const { signal: conflictSignal } = await seedConflictFixture(
    market.id,
    market.conditionId,
  );
  const run3 = await runEngine();
  const conflictOrder = await prisma.executionOrder.findUnique({
    where: { idempotencyKey: idempotencyKeyForSignal(conflictSignal.id) },
  });
  const conflictBlocked =
    !conflictOrder ||
    conflictOrder.status === "BLOCKED" ||
    run3.blocked > 0;

  const { PolymarketExecutionProvider } = await import("@augurium/execution");
  const polyProbe = new PolymarketExecutionProvider();
  const polyOrder = await polyProbe.placeOrder({
    idempotencyKey: "e2e-polymarket-must-not-run",
    signalId: signal.id,
    marketId: market.id,
    side: "YES",
    orderType: "LIMIT",
    requestedSizeUsd: 1,
  });
  const polymarketPlaceAttempt = polyOrder.success ? "called_success" : "not_ready_blocked";

  const safety = {
    executionEnabled: cfg.executionEnabled,
    provider: cfg.provider,
    liveTradingEnabled: cfg.liveTradingEnabled,
    allowRealMoney: cfg.allowRealMoney,
    livePolymarketEnabled: isLivePolymarketEnabled(cfg),
    executionMode: executionModeLabel(cfg),
    realMoneyRisk: false,
  };

  const checks = {
    executionOrderCreated: !!order && order.status === "FILLED",
    executionFillCreated: fills.length > 0,
    executionPositionCreated: !!position && position.status === "OPEN",
    duplicatePrevention:
      orderCountAfterDup === 1 && (run2.blocked > 0 || run2.placed === 0),
    conflictPrevention: conflictBlocked,
    reconciliationOk: recon?.status === "OK",
    discordPaperAlert:
      !!discordEvent &&
      (discordEvent.title.includes("PAPER") || discordEvent.eventType === "EXECUTION_PAPER"),
    noPolymarketOrders: (await verifyNoPolymarketArtifacts(signal.id)).ok,
    polymarketProviderNotUsed:
      cfg.provider === "paper" && polymarketPlaceAttempt === "not_ready_blocked",
    firstRunPlaced: run1.placed >= 1,
  };

  const passed = Object.values(checks).every(Boolean);

  const report = {
    phase: "G-paper-e2e",
    passed,
    fixtures: {
      marketId: market.id,
      signalId: signal.id,
      portfolioDecisionId: decision.id,
      conflictSignalId: conflictSignal.id,
    },
    ids: {
      orderId: order?.id ?? null,
      fillIds: fills.map((f) => f.id),
      positionId: position?.id ?? null,
    },
    runs: {
      first: run1,
      duplicateProbe: run2,
      conflictProbe: run3,
    },
    duplicatePrevention: {
      orderCount: orderCountAfterDup,
      expected: 1,
      blockedOnSecondRun: run2.blocked,
      passed: checks.duplicatePrevention,
    },
    conflictPrevention: {
      conflictOrderStatus: conflictOrder?.status ?? "none",
      blockReason: conflictOrder?.blockReason ?? null,
      passed: checks.conflictPrevention,
    },
    discord: {
      eventId: discordEvent?.id ?? null,
      eventType: discordEvent?.eventType ?? null,
      title: discordEvent?.title ?? null,
      status: discordEvent?.status ?? null,
      passed: checks.discordPaperAlert,
      note:
        discordEvent?.status === "SKIPPED"
          ? "Event queued; enable DISCORD_ENABLED + webhook to send"
          : "PAPER EXECUTION alert recorded",
    },
    reconciliation: {
      status: recon?.status ?? null,
      provider: recon?.provider ?? null,
      passed: checks.reconciliationOk,
    },
    safety,
    providerIsolation: await verifyNoPolymarketArtifacts(signal.id),
    checks,
    cleanup: "Run: npm run paper:e2e -- --cleanup",
  };

  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
