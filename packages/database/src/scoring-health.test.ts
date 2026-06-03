import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScoringHealth, scoringWarningMessage } from "./scoring-health.js";

describe("computeScoringHealth", () => {
  it("marks healthy when no unscored eligible remain", () => {
    const m = computeScoringHealth(192, 0);
    assert.equal(m.eligibleWallets, 192);
    assert.equal(m.scoreCoverageEligiblePct, 100);
    assert.equal(m.scoringHealthy, true);
    assert.equal(scoringWarningMessage(m), null);
  });

  it("warns when eligible backlog remains", () => {
    const m = computeScoringHealth(50, 10);
    assert.equal(m.eligibleWallets, 60);
    assert.ok(m.scoreCoverageEligiblePct < 100);
    assert.equal(m.scoringHealthy, false);
    assert.ok(scoringWarningMessage(m)?.includes("10"));
  });
});
