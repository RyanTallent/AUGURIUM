import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyInvalidForAnalytics,
  isImpossibleFlatPnl,
  markToMarketPnl,
  maxPossibleRoi,
  priceHitsRunnerTarget,
  pricesEffectivelyEqual,
  resolvedLoserPnl,
  resolvedWinnerPnl,
  roiFromPnl,
  validateClosedPayout,
} from "./payout.js";
import { applyAuguriumExitRules, computePositionMetrics } from "./exit-rules.js";
import { recomputeClosedPayout } from "./payout-reconcile.js";

describe("pricesEffectivelyEqual", () => {
  it("treats near-equal prices as flat", () => {
    assert.ok(pricesEffectivelyEqual(0.025, 0.0250000001));
    assert.ok(isImpossibleFlatPnl(0.025, 0.025, 100));
  });
});

describe("markToMarketPnl", () => {
  it("entry == exit gives PnL 0", () => {
    const pnl = markToMarketPnl({
      entryPrice: 0.025,
      exitPrice: 0.025,
      costBasis: 100,
      outcomeSide: "YES",
      positionFraction: 1,
    });
    assert.equal(pnl, 0);
  });

  it("YES gains when price rises", () => {
    const pnl = markToMarketPnl({
      entryPrice: 0.4,
      exitPrice: 0.5,
      costBasis: 100,
      outcomeSide: "YES",
      positionFraction: 1,
    });
    assert.ok(Math.abs(pnl - 25) < 0.01);
  });

  it("NO gains when price falls", () => {
    const pnl = markToMarketPnl({
      entryPrice: 0.7,
      exitPrice: 0.4,
      costBasis: 100,
      outcomeSide: "NO",
      positionFraction: 1,
    });
    assert.ok(pnl > 0);
  });
});

describe("resolved payout", () => {
  it("YES resolved winner", () => {
    const pnl = resolvedWinnerPnl(100, 0.4, 1);
    assert.ok(Math.abs(pnl - 150) < 0.01);
    assert.equal(roiFromPnl(pnl, 100), 1.5);
  });

  it("YES resolved loser", () => {
    const pnl = resolvedLoserPnl(100, 1);
    assert.equal(pnl, -100);
    assert.equal(roiFromPnl(pnl, 100), -1);
  });

  it("NO resolved winner when YES price near 0", () => {
    const pnl = markToMarketPnl({
      entryPrice: 0.6,
      exitPrice: 0.02,
      costBasis: 100,
      outcomeSide: "NO",
      positionFraction: 1,
    });
    assert.ok(pnl > 0);
  });
});

describe("runner target price", () => {
  it("entry 0.025 requires 0.0375 for YES runner not $1", () => {
    assert.equal(priceHitsRunnerTarget(0.025, 0.0375, "YES"), true);
    assert.ok(priceHitsRunnerTarget(0.025, 0.04, "YES"));
    assert.equal(priceHitsRunnerTarget(0.025, 0.03, "YES"), false);
  });
});

describe("partial and runner exits", () => {
  it("partial profit at +20% price uses share math only", () => {
    const entry = 0.4;
    const exit = 0.48;
    const base = computePositionMetrics(entry, exit, 100, 1, 0, "YES");
    const { state, decision } = applyAuguriumExitRules(
      { ...base, maxFavorableExcursion: 0.2, maxAdverseExcursion: 0 },
      {
        currentPrice: exit,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        marketResolved: false,
        consensusCollapsed: false,
      },
      "test",
    );
    assert.equal(decision, null);
    assert.ok(state.partialExitDone);
    assert.ok(state.realizedPnl > 0);
    assert.ok(state.realizedPnl < 100);
  });

  it("consensus collapse closes at current price not resolution", () => {
    const entry = 0.5;
    const exit = 0.52;
    const base = computePositionMetrics(entry, exit, 100, 1, 0, "YES");
    const { state, decision } = applyAuguriumExitRules(
      { ...base, maxFavorableExcursion: 0, maxAdverseExcursion: 0 },
      {
        currentPrice: exit,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: true,
        marketClosed: false,
        marketResolved: false,
        consensusCollapsed: true,
      },
      "entry",
    );
    assert.ok(decision);
    const expected = markToMarketPnl({
      entryPrice: entry,
      exitPrice: exit,
      costBasis: 100,
      outcomeSide: "YES",
      positionFraction: 1,
    });
    assert.ok(Math.abs(state.realizedPnl - expected) < 0.01);
  });
});

describe("validateClosedPayout", () => {
  it("rejects entry==exit with nonzero PnL", () => {
    const v = validateClosedPayout({
      entryPrice: 0.025,
      exitPrice: 0.025,
      costBasis: 100,
      realizedPnl: 3800,
      outcomeSide: "YES",
      formula: "mark_to_market",
      partialExitDone: false,
      positionRemainingAtClose: 0,
      priorRealizedPnl: 0,
    });
    assert.equal(v.valid, false);
    assert.equal(v.diagnostic, "entry_equals_exit_nonzero_pnl");
  });
});

describe("recomputeClosedPayout", () => {
  it("corrects flat entry exit impossible PnL", () => {
    const r = recomputeClosedPayout({
      entryPrice: 0.025,
      exitPrice: 0.025,
      costBasis: 100,
      outcomeSide: "YES",
      partialExitDone: false,
      closeReason: "consensus collapsed",
      marketResolved: false,
      storedRealizedPnl: 3800,
    });
    assert.equal(r.realizedPnl, 0);
    assert.equal(r.invalidForAnalytics, false);
  });
});

describe("invalid analytics guards", () => {
  it("flags duplicate close", () => {
    const v = validateClosedPayout({
      entryPrice: 0.5,
      exitPrice: 0.55,
      costBasis: 100,
      realizedPnl: 10,
      outcomeSide: "YES",
      formula: "mark_to_market",
      partialExitDone: false,
      positionRemainingAtClose: 0,
      priorRealizedPnl: 0,
    });
    const c = classifyInvalidForAnalytics(v, { duplicateClose: true });
    assert.equal(c.invalid, true);
    assert.equal(c.reason, "duplicate_close");
  });

  it("ROI cannot exceed mathematically possible bounds for YES", () => {
    const entry = 0.025;
    const max = maxPossibleRoi(entry, "YES", false);
    assert.ok(max < 40);
    const exit = 0.99;
    const v = validateClosedPayout({
      entryPrice: entry,
      exitPrice: exit,
      costBasis: 100,
      realizedPnl: 5000,
      outcomeSide: "YES",
      formula: "mark_to_market",
      partialExitDone: false,
      positionRemainingAtClose: 0,
      priorRealizedPnl: 0,
    });
    assert.equal(v.valid, false);
    assert.equal(v.diagnostic, "roi_exceeds_bounds");
  });
});
