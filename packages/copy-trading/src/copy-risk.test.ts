import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capAllocationPct, evaluateTraderDrawdownDisable } from "./copy-risk.js";
import { buildTraderTruth } from "./trader-truth.js";

describe("copy risk", () => {
  it("caps allocation at 5%", () => {
    assert.equal(capAllocationPct(0.12), 0.05);
  });

  it("disables trader above drawdown cap", () => {
    const truth = buildTraderTruth(
      {
        id: "t1",
        address: "0x1",
        tier: "ELITE",
        copyabilityScore: 0.5,
        confidenceScore: 0.6,
        estimatedCopiedRoi: 0.1,
        rankingScore: 80,
        winRate: 0.5,
        roi: 0.1,
        trades: 50,
        recentFormScore: 0.5,
        bestCategory: null,
      },
      null,
    );
    truth.maxDrawdown = 0.35;
    const r = evaluateTraderDrawdownDisable(truth);
    assert.equal(r.disabled, true);
  });
});
