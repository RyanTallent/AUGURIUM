import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeLiveTradeSizeUsd,
  canAddDeployedExposure,
} from "./copy-live-sizing.js";

describe("copy live sizing", () => {
  const config = { positionPct: 0.15, maxDeployedPct: 0.5, minTradeUsd: 5 };

  it("sizes trades at 15% of bankroll", () => {
    assert.equal(computeLiveTradeSizeUsd(200, 0, config, 200), 30);
  });

  it("shrinks trade when near 50% deploy cap", () => {
    assert.equal(computeLiveTradeSizeUsd(200, 85, config, 200), 15);
  });

  it("returns zero when deploy cap is full", () => {
    assert.equal(computeLiveTradeSizeUsd(200, 100, config, 200), 0);
  });

  it("caps by available buying power", () => {
    assert.equal(computeLiveTradeSizeUsd(200, 0, config, 20), 20);
  });

  it("blocks when total deploy would exceed 50%", () => {
    const r = canAddDeployedExposure(200, 90, 30, 0.5);
    assert.equal(r.allowed, false);
  });
});
