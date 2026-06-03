import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvidenceToSignalType, evaluateSignalEvidence } from "./evidence.js";

describe("signal evidence gating", () => {
  it("downgrades TRADE_NOW without enough traders", () => {
    const evidence = evaluateSignalEvidence({
      consensus: {
        outcomeSide: "YES",
        consensusScore: 90,
        copyabilityScore: 0.9,
        informationEdgeScore: 0.8,
        convictionScore: 0.7,
        disagreementScore: 0.1,
        opposingConsensus: 20,
        tradeCount: 2,
        triggerTradeIds: ["a", "b"],
        triggerTraderWallets: ["0x1", "0x2"],
        medianCopiedRoi: 0.05,
        combinedNotional: 400,
        oldestTriggerTradeAt: new Date(),
        newestTriggerTradeAt: new Date(),
      },
      marketQualityScore: 70,
      systemConfidenceScore: 60,
      hasSuperElite: false,
    });
    assert.equal(applyEvidenceToSignalType("TRADE_NOW", evidence), "RESEARCH");
  });
});
