import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closedPositionRoi,
  isCorruptRoi,
  isPlausibleEntryPrice,
  roiAnomalyTier,
  storedRoiMismatch,
} from "./roi.js";
import { applyAuguriumExitRules, computePositionMetrics, updateExcursions } from "./exit-rules.js";

describe("closedPositionRoi", () => {
  it("equals realizedPnl / capital at risk", () => {
    assert.equal(closedPositionRoi(20, 100), 0.2);
    assert.equal(closedPositionRoi(-15, 100), -0.15);
  });
});

describe("roi anomalies", () => {
  it("flags extreme ROI", () => {
    assert.equal(roiAnomalyTier(1.5), "gt_100pct");
    assert.equal(roiAnomalyTier(6), "gt_500pct");
    assert.ok(isCorruptRoi(12));
  });
});

describe("entry plausibility", () => {
  it("rejects tiny entry prices that explode ROI", () => {
    assert.equal(isPlausibleEntryPrice(0.001), false);
    assert.equal(isPlausibleEntryPrice(0.45), true);
  });
});

describe("exit rules ROI", () => {
  it("YES winner partial + runner close uses PnL / notional", () => {
    const base = computePositionMetrics(0.4, 0.5, 100, 1, 0, "YES");
    const withExc = updateExcursions(base, base.roi);
    const partial = applyAuguriumExitRules(
      withExc,
      {
        currentPrice: 0.5,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
      "test",
    );
    assert.equal(partial.decision, null);
    assert.ok(partial.state.realizedPnl > 0);

    const runner = applyAuguriumExitRules(
      {
        ...partial.state,
        partialExitDone: true,
        runnerActive: true,
        positionRemaining: 0.15,
      },
      {
        currentPrice: 0.65,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
      "test",
    );
    assert.ok(runner.decision);
    const totalRoi = closedPositionRoi(runner.state.realizedPnl, 100);
    assert.equal(runner.state.roi, totalRoi);
    assert.ok(totalRoi > 0 && totalRoi < 2);
  });

  it("YES loser on market close", () => {
    const base = computePositionMetrics(0.6, 0.35, 100, 1, 0, "YES");
    const { state, decision } = applyAuguriumExitRules(
      { ...base, maxFavorableExcursion: 0, maxAdverseExcursion: -0.4 },
      {
        currentPrice: 0.35,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: true,
        consensusCollapsed: false,
      },
      "entry",
    );
    assert.ok(decision);
    assert.ok(state.realizedPnl < 0);
    assert.equal(state.roi, closedPositionRoi(state.realizedPnl, 100));
  });

  it("NO winner gains when price falls", () => {
    const base = computePositionMetrics(0.7, 0.4, 100, 1, 0, "NO");
    const { state, decision } = applyAuguriumExitRules(
      { ...base, maxFavorableExcursion: 0.4, maxAdverseExcursion: 0 },
      {
        currentPrice: 0.4,
        outcomeSide: "NO",
        signalExpired: false,
        signalInactive: false,
        marketClosed: true,
        consensusCollapsed: false,
      },
      "entry",
    );
    assert.ok(decision);
    assert.ok(state.realizedPnl > 0);
  });

  it("expired signal closes with EXPIRED status", () => {
    const base = computePositionMetrics(0.5, 0.5, 100, 1, 0, "YES");
    const { decision } = applyAuguriumExitRules(
      { ...base, maxFavorableExcursion: 0, maxAdverseExcursion: 0 },
      {
        currentPrice: 0.5,
        outcomeSide: "YES",
        signalExpired: true,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
      "entry",
    );
    assert.equal(decision?.status, "EXPIRED");
  });

  it("stored vs authoritative mismatch detection", () => {
    assert.ok(storedRoiMismatch(5, 0.2));
    assert.equal(storedRoiMismatch(0.2, 0.21, 0.02), false);
  });
});
