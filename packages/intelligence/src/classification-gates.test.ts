import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMarketSignal } from "./classification-gates.js";

describe("classifyMarketSignal", () => {
  it("downgrades TRADE_NOW when evidence insufficient", () => {
    const result = classifyMarketSignal({
      watchlist: {
        consensusScore: 90,
        alphaScore: 85,
        marketQualityScore: 60,
        systemConfidenceScore: 55,
        hasScoredTraderActivity: true,
        insufficientData: false,
        uniqueTraders: 3,
        disagreementScore: 0.1,
      },
      evidence: {
        consensus: {
          outcomeSide: "YES",
          consensusScore: 90,
          copyabilityScore: 0.5,
          informationEdgeScore: 0.5,
          convictionScore: 0.5,
          disagreementScore: 0.1,
          opposingConsensus: 10,
          tradeCount: 3,
          triggerTradeIds: ["a", "b", "c"],
          triggerTraderWallets: ["w1", "w2"],
          medianCopiedRoi: 0.1,
          combinedNotional: 400,
          oldestTriggerTradeAt: null,
          newestTriggerTradeAt: null,
        },
        marketQualityScore: 60,
        systemConfidenceScore: 55,
        hasSuperElite: false,
      },
      insufficientDataForced: false,
      skipReason: null,
    });
    assert.equal(result.baseSignalType, "TRADE_NOW");
    assert.notEqual(result.finalSignalType, "TRADE_NOW");
    assert.ok(result.promotionReasons.length > 0);
  });
});
