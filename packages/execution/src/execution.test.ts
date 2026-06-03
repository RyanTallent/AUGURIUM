import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  evaluateExecutionGates,
  executionModeLabel,
  getExecutionConfig,
  MemoryLockStore,
  MemoryPaperStore,
  PaperExecutionProvider,
  PolymarketExecutionProvider,
  idempotencyKeyForSignal,
  lockKeyForSignal,
  redactSecrets,
} from "./index.js";

const baseGateInput = {
  signalType: "TRADE_NOW",
  portfolioDecision: "ACCEPT",
  marketActive: true,
  marketClosed: false,
  hasMockSignal: false,
  credentialsValid: true,
  reconciliationOk: true,
  duplicateSignalOrder: false,
  duplicateMarketSide: false,
  conflictingOppositeSide: false,
  slippageBps: 50,
  maxSlippageBps: 100,
  deployedPct: 0.2,
  maxDeployedPct: 0.8,
  positionPct: 0.1,
  maxPositionPct: 0.25,
  dailyLossUsd: 0,
  maxDailyLossUsd: 25,
};

describe("paper execution", () => {
  let store: MemoryPaperStore;
  let provider: PaperExecutionProvider;

  beforeEach(() => {
    store = new MemoryPaperStore();
    store.setPrice("m1", 0.55);
    provider = new PaperExecutionProvider(store);
  });

  it("places order and creates fill", async () => {
    const key = idempotencyKeyForSignal("sig-1");
    const result = await provider.placeOrder({
      idempotencyKey: key,
      signalId: "sig-1",
      marketId: "m1",
      side: "YES",
      orderType: "LIMIT",
      requestedSizeUsd: 7,
      requestedPrice: 0.55,
    });
    assert.equal(result.success, true);
    assert.equal(result.status, "FILLED");
    assert.ok(result.filledSizeUsd === 7);
    const positions = await provider.getOpenPositions();
    assert.equal(positions.length, 1);
  });

  it("prevents duplicate idempotent order", async () => {
    const req = {
      idempotencyKey: idempotencyKeyForSignal("sig-dup"),
      signalId: "sig-dup",
      marketId: "m1",
      side: "YES",
      orderType: "LIMIT" as const,
      requestedSizeUsd: 5,
      requestedPrice: 0.5,
    };
    await provider.placeOrder(req);
    const again = await provider.placeOrder(req);
    assert.equal(again.success, true);
    const orders = await store.getOpenOrders();
    assert.equal(orders.length, 0);
    assert.equal((await provider.getOpenPositions()).length, 1);
  });

  it("blocks conflicting opposite side", async () => {
    await provider.placeOrder({
      idempotencyKey: "o1",
      signalId: "s1",
      marketId: "m1",
      side: "YES",
      orderType: "LIMIT",
      requestedSizeUsd: 5,
      requestedPrice: 0.5,
    });
    const no = await provider.placeOrder({
      idempotencyKey: "o2",
      signalId: "s2",
      marketId: "m1",
      side: "NO",
      orderType: "LIMIT",
      requestedSizeUsd: 5,
      requestedPrice: 0.5,
    });
    assert.equal(no.success, false);
    assert.match(no.errorMessage ?? "", /conflicting/i);
  });
});

describe("idempotency lock", () => {
  it("acquire and release", async () => {
    const locks = new MemoryLockStore();
    const key = lockKeyForSignal("sig-lock");
    assert.equal(await locks.acquire(key, "worker-1", 5000), true);
    assert.equal(await locks.acquire(key, "worker-2", 5000), false);
    await locks.release(key, "worker-1");
    assert.equal(await locks.acquire(key, "worker-2", 5000), true);
  });
});

describe("safety gates", () => {
  it("blocks when execution disabled", () => {
    const prev = process.env.EXECUTION_ENABLED;
    process.env.EXECUTION_ENABLED = "false";
    const r = evaluateExecutionGates(baseGateInput);
    assert.equal(r.allowed, false);
    assert.ok(r.reasons.some((x) => x.includes("EXECUTION_ENABLED")));
    process.env.EXECUTION_ENABLED = prev;
  });

  it("requires TRADE_NOW and ACCEPT", () => {
    process.env.EXECUTION_ENABLED = "true";
    process.env.EXECUTION_PROVIDER = "paper";
    const r = evaluateExecutionGates({
      ...baseGateInput,
      signalType: "RESEARCH",
      portfolioDecision: "REJECT",
    });
    assert.equal(r.allowed, false);
  });
});

describe("polymarket provider", () => {
  it("is NOT_READY for placeOrder", async () => {
    const p = new PolymarketExecutionProvider();
    const health = await p.healthCheck();
    assert.equal(health.ready, false);
    const order = await p.placeOrder({
      idempotencyKey: "x",
      signalId: "s",
      marketId: "m",
      side: "YES",
      orderType: "LIMIT",
      requestedSizeUsd: 1,
    });
    assert.equal(order.success, false);
  });

  it("validates credentials without logging secrets", async () => {
    const p = new PolymarketExecutionProvider();
    const prev = {
      k: process.env.POLYMARKET_PRIVATE_KEY,
      a: process.env.POLYMARKET_API_KEY,
      s: process.env.POLYMARKET_API_SECRET,
      p: process.env.POLYMARKET_API_PASSPHRASE,
      f: process.env.POLYMARKET_FUNDER_ADDRESS,
    };
    process.env.POLYMARKET_PRIVATE_KEY = "a".repeat(64);
    process.env.POLYMARKET_API_KEY = "key";
    process.env.POLYMARKET_API_SECRET = "secret";
    process.env.POLYMARKET_API_PASSPHRASE = "pass";
    process.env.POLYMARKET_FUNDER_ADDRESS = "0xabc";
    const v = await p.validateCredentials();
    assert.equal(v.configured, true);
    const logged = redactSecrets(
      `POLYMARKET_PRIVATE_KEY=${process.env.POLYMARKET_PRIVATE_KEY}`,
    );
    assert.ok(!logged.includes("aaaa"));
    assert.ok(logged.includes("REDACTED"));
    Object.assign(process.env, {
      POLYMARKET_PRIVATE_KEY: prev.k,
      POLYMARKET_API_KEY: prev.a,
      POLYMARKET_API_SECRET: prev.s,
      POLYMARKET_API_PASSPHRASE: prev.p,
      POLYMARKET_FUNDER_ADDRESS: prev.f,
    });
  });
});

describe("redact", () => {
  it("redacts private key patterns", () => {
    assert.ok(redactSecrets("POLYMARKET_PRIVATE_KEY=0xSECRET").includes("REDACTED"));
  });
});

describe("partial exit 85%", () => {
  it("triggers partial exit at +20%", async () => {
    const { evaluateExecutionExit } = await import("./exit-engine.js");
    const r = evaluateExecutionExit(
      {
        entryPrice: 0.5,
        currentPrice: 0.62,
        sizeUsd: 10,
        positionRemaining: 1,
        realizedPnl: 0,
        partialExitDone: false,
        runnerActive: false,
        side: "YES",
      },
      {
        currentPrice: 0.62,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
    );
    assert.equal(r.shouldClose, true);
    assert.equal(r.partialExit, true);
    assert.ok(r.closeFraction >= 0.84);
  });
});

describe("config defaults", () => {
  it("defaults to safe disabled mode", () => {
    delete process.env.EXECUTION_ENABLED;
    delete process.env.LIVE_TRADING_ENABLED;
    const cfg = getExecutionConfig();
    assert.equal(cfg.executionEnabled, false);
    assert.equal(cfg.liveTradingEnabled, false);
    assert.equal(executionModeLabel(cfg), "DISABLED");
  });
});
