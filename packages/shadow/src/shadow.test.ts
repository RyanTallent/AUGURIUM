import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAuguriumExitRules,
  computePositionMetrics,
  updateExcursions,
} from "./exit-rules.js";
import { directionalRoi, priceAtOrAfter } from "./math.js";
import { runAllSimulations, shadowTradeKey, SIMULATION_STRATEGIES } from "./simulate.js";
import { buildReplayPayload, validateReplayPayload } from "./replay.js";
import { DEFAULT_SIZE_USD } from "./types.js";

describe("shadow trade key", () => {
  it("uses signal id for deduplication", () => {
    assert.equal(shadowTradeKey("sig-1"), "sig-1");
    assert.equal(shadowTradeKey("sig-1"), shadowTradeKey("sig-1"));
  });
});

describe("partial profit-taking", () => {
  it("exits 85% at +20% ROI and keeps runner", () => {
    const base = computePositionMetrics(0.4, 0.5, 100, 1, 0, "YES");
    const withExc = updateExcursions(base, 0.25);
    const { state, decision } = applyAuguriumExitRules(
      { ...withExc, maxFavorableExcursion: 0.25, maxAdverseExcursion: 0 },
      {
        currentPrice: 0.5,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        marketResolved: false,
        consensusCollapsed: false,
      },
      "entry test",
    );
    assert.equal(decision, null);
    assert.ok(state.positionRemaining <= 0.16);
    assert.ok(state.realizedPnl > 0);
    assert.equal(state.partialExitDone, true);
  });
});

describe("runner logic", () => {
  it("closes runner at +50% ROI", () => {
    const base = computePositionMetrics(0.4, 0.65, 100, 0.15, 17, "YES");
    const state = {
      ...base,
      partialExitDone: true,
      runnerActive: true,
      maxFavorableExcursion: 0.6,
      maxAdverseExcursion: 0,
    };
    const { decision } = applyAuguriumExitRules(
      state,
      {
        currentPrice: 0.65,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        marketResolved: false,
        consensusCollapsed: false,
      },
      "entry",
    );
    assert.ok(decision);
    assert.equal(decision?.status, "CLOSED");
    assert.match(decision?.closeReason ?? "", /runner/i);
  });
});

describe("simulation strategies", () => {
  it("outputs all strategy results deterministically", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const tape = [
      { tradedAt: new Date("2026-06-02T12:00:30Z"), price: 0.4 },
      { tradedAt: new Date("2026-06-02T12:05:00Z"), price: 0.48 },
      { tradedAt: new Date("2026-06-02T12:30:00Z"), price: 0.55 },
    ];
    const results = runAllSimulations({
      strategyName: "augurium_rules",
      entryDelayMs: 180_000,
      entryPrice: 0.4,
      priceSeries: tape,
      signalCreatedAt: now,
      signalExpiresAt: new Date("2026-06-02T18:00:00Z"),
      marketClosed: false,
      simulatedSizeUsd: DEFAULT_SIZE_USD,
      side: "YES",
    });
    assert.equal(results.length, SIMULATION_STRATEGIES.length);
    assert.ok(results.every((r) => r.strategyName.length > 0));
    assert.ok(results.some((r) => Number.isFinite(r.roi)));
    const aug = results.find((r) => r.strategyName === "augurium_rules");
    assert.ok(aug && aug.roi >= 0);
  });
});

describe("replay snapshot", () => {
  it("has required shape", () => {
    const payload = buildReplayPayload({
      capturedAt: new Date(),
      signal: { id: "s1", signalType: "RESEARCH" },
      market: { id: "m1", title: "Test" },
      recentTrades: [{ price: 0.5 }],
      triggerTraders: [{ address: "0xabc" }],
      simulatedSizeUsd: 100,
      entryDelayMs: 180_000,
      entryDelayLabel: "3m",
      reasoning: "RESEARCH because traders entered",
    });
    assert.equal(validateReplayPayload(payload), true);
  });
});

describe("missed profit tracking", () => {
  it("flags hold would have been better when MFE exceeds exit", () => {
    const base = computePositionMetrics(0.4, 0.7, 100, 0.15, 17, "YES");
    const { decision } = applyAuguriumExitRules(
      {
        ...base,
        partialExitDone: true,
        runnerActive: true,
        maxFavorableExcursion: 0.8,
        maxAdverseExcursion: -0.05,
      },
      {
        currentPrice: 0.7,
        outcomeSide: "YES",
        signalExpired: true,
        signalInactive: true,
        marketClosed: false,
        marketResolved: false,
        consensusCollapsed: true,
      },
      "entry",
    );
    assert.ok(decision);
    assert.ok(decision!.missedProfitAfterExit >= 0);
  });
});

describe("entry price from tape", () => {
  it("uses nearest later trade price", () => {
    const tape = [
      { tradedAt: new Date("2026-06-02T12:00:00Z"), price: 0.3 },
      { tradedAt: new Date("2026-06-02T12:03:00Z"), price: 0.42 },
    ];
    const ms = new Date("2026-06-02T12:01:00Z").getTime();
    assert.equal(priceAtOrAfter(tape, ms), 0.42);
    assert.ok(directionalRoi(0.42, 0.5, "YES") > 0);
  });
});
