import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTraderTruth } from "./trader-truth.js";
import { decideCopyTrader } from "./copy-decision.js";

describe("copy decision", () => {
  it("recommends COPY for strong copyable trader", () => {
    const truth = buildTraderTruth(
      {
        id: "t1",
        address: "0xabc",
        tier: "ELITE",
        copyabilityScore: 0.65,
        confidenceScore: 0.8,
        rankingScore: 98,
        winRate: 0.62,
        roi: 0.2,
        trades: 40,
        lowConfidence: false,
        estimatedCopiedRoi: 0.25,
        recentFormScore: 0.65,
        bestCategory: "Politics",
      },
      null,
    );
    const d = decideCopyTrader(truth);
    assert.equal(d.recommendation, "COPY");
    assert.ok(d.suggestedUsdAt10k > 0);
  });

  it("recommends AVOID for deteriorating low sample", () => {
    const truth = buildTraderTruth(
      {
        id: "t2",
        address: "0xdef",
        tier: "PROSPECT",
        copyabilityScore: 0.1,
        confidenceScore: 0.3,
        estimatedCopiedRoi: -0.05,
        rankingScore: 40,
        winRate: 0.4,
        roi: -0.1,
        trades: 5,
        recentFormScore: 0.2,
        bestCategory: null,
      },
      null,
    );
    truth.formTrend = "deteriorating";
    const d = decideCopyTrader(truth);
    assert.equal(d.recommendation, "AVOID");
  });
});
