import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDisagreementScore,
  computeSideConsensus,
} from "./consensus.js";
import { computeMarketQualityScore } from "./market-quality.js";
import { computeAlphaScore } from "./alpha.js";
import { computeSystemConfidenceScore } from "./system-confidence.js";
import { classifySignalType } from "./watchlist.js";
import { buildSignalReasoning } from "./reasoning.js";
import { assertNoRandomness } from "./pipeline.js";
import type { ConsensusTradeInput, MarketQualityInput } from "./types.js";

const traderHigh = {
  rankingScore: 80,
  estimatedCopiedRoi: 0.08,
  copyabilityScore: 0.9,
  informationEdgeScore: 0.85,
  confidenceScore: 0.7,
  recentFormScore: 0.6,
  tier: "RISING",
  lowConfidence: false,
};

const traderLow = {
  rankingScore: 20,
  estimatedCopiedRoi: -0.02,
  copyabilityScore: 0.2,
  informationEdgeScore: 0.2,
  confidenceScore: 0.2,
  recentFormScore: 0.2,
  tier: "UNRANKED",
  lowConfidence: true,
};

function trade(
  id: string,
  wallet: string,
  side: string,
  outcome: string,
  size: number,
  price: number,
  profile: typeof traderHigh,
  tradedAt: Date,
): ConsensusTradeInput {
  return {
    tradeId: id,
    wallet,
    marketId: "m1",
    conditionId: "0x1",
    side,
    outcome,
    size,
    price,
    tradedAt,
    trader: profile,
  };
}

describe("consensus", () => {
  it("weights quality over raw count", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const high = [
      trade("1", "0xA", "BUY", "YES", 500, 0.6, traderHigh, new Date("2026-06-02T11:00:00Z")),
    ];
    const lowOnly = Array.from({ length: 5 }, (_, i) =>
      trade(
        `l${i}`,
        `0xL${i}`,
        "BUY",
        "NO",
        10,
        0.5,
        traderLow,
        new Date("2026-06-01T08:00:00Z"),
      ),
    );

    const yes = computeSideConsensus("YES", high, now);
    const no = computeSideConsensus("NO", lowOnly, now);
    assert.ok(yes.consensusScore > no.consensusScore);
  });

  it("computes disagreement when sides conflict", () => {
    const d = computeDisagreementScore(80, 75);
    assert.ok(d > 0.9);
    const d2 = computeDisagreementScore(80, 20);
    assert.ok(d2 < 0.5);
  });
});

describe("market quality", () => {
  it("penalizes stale closed markets", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const active: MarketQualityInput = {
      marketId: "m1",
      active: true,
      closed: false,
      resolved: false,
      acceptingOrders: true,
      endDate: new Date("2026-12-01"),
      recentTrades: [
        { price: 0.5, size: 100, tradedAt: new Date("2026-06-02T10:00:00Z") },
        { price: 0.52, size: 80, tradedAt: new Date("2026-06-02T11:00:00Z") },
      ],
      volume7d: 5000,
      tradeCount7d: 40,
      tradeCount24h: 10,
      uniqueTraders7d: 12,
    };
    const closed = { ...active, closed: true, resolved: true, recentTrades: [] };
    assert.ok(computeMarketQualityScore(active, now) > computeMarketQualityScore(closed, now));
  });
});

describe("alpha", () => {
  it("ranks high consensus and quality", () => {
    const alpha = computeAlphaScore({
      consensus: {
        outcomeSide: "YES",
        consensusScore: 90,
        copyabilityScore: 0.9,
        informationEdgeScore: 0.8,
        convictionScore: 0.7,
        disagreementScore: 0.1,
        opposingConsensus: 30,
        tradeCount: 4,
        triggerTradeIds: [],
        triggerTraderWallets: [],
        medianCopiedRoi: 0.07,
        combinedNotional: 1200,
        oldestTriggerTradeAt: null,
        newestTriggerTradeAt: null,
      },
      marketQualityScore: 80,
      disagreementScore: 0.1,
      capitalEfficiency: 0.6,
      movementConfirmation: 0.5,
    });
    assert.ok(alpha >= 75);
  });
});

describe("watchlist", () => {
  it("classifies TRADE_NOW only with strong scores", () => {
    assert.equal(
      classifySignalType({
        consensusScore: 88,
        alphaScore: 82,
        marketQualityScore: 70,
        systemConfidenceScore: 55,
        hasScoredTraderActivity: true,
        insufficientData: false,
        uniqueTraders: 4,
        disagreementScore: 0.1,
      }),
      "TRADE_NOW",
    );
    assert.equal(
      classifySignalType({
        consensusScore: 88,
        alphaScore: 82,
        marketQualityScore: 70,
        systemConfidenceScore: 55,
        hasScoredTraderActivity: true,
        insufficientData: true,
        uniqueTraders: 1,
        disagreementScore: 0.5,
      }),
      "IGNORE",
    );
  });
});

describe("reasoning", () => {
  it("produces explainable text", () => {
    const text = buildSignalReasoning({
      signalType: "WATCHLIST",
      outcomeSide: "YES",
      category: "Politics",
      consensus: {
        outcomeSide: "YES",
        consensusScore: 78,
        copyabilityScore: 0.85,
        informationEdgeScore: 0.7,
        convictionScore: 0.6,
        disagreementScore: 0.2,
        opposingConsensus: 40,
        tradeCount: 3,
        triggerTradeIds: ["t1"],
        triggerTraderWallets: ["0xabc"],
        medianCopiedRoi: 0.072,
        combinedNotional: 800,
        oldestTriggerTradeAt: new Date("2026-06-02T10:00:00Z"),
        newestTriggerTradeAt: new Date("2026-06-02T11:00:00Z"),
      },
      alphaScore: 74,
      marketQualityScore: 81,
      systemConfidenceScore: 62,
      disagreementScore: 0.2,
      skipReason: null,
      windowMinutes: 120,
      evidenceNote: null,
    });
    assert.match(text, /WATCHLIST/);
    assert.match(text, /consensus 78/);
    assert.match(text, /scored trader/);
    assert.match(text, /0xabc/);
  });
});

describe("safety", () => {
  it("has no random signal generation hook", () => {
    assert.equal(assertNoRandomness(), true);
    assert.equal(typeof Math.random, "function");
    const src = buildSignalReasoning.toString();
    assert.ok(!src.includes("Math.random"));
  });
});

describe("system confidence", () => {
  it("increases with coverage and freshness", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const high = computeSystemConfidenceScore({
      totalTrades: 3000,
      recentTrades: 500,
      tradesWithScoredTrader: 400,
      scoredTraderCount: 80,
      marketsWithRecentActivity: 40,
      lastTradeAt: new Date("2026-06-02T11:00:00Z"),
      lastIngestSuccessAt: new Date("2026-06-02T10:00:00Z"),
      lastScoreSuccessAt: new Date("2026-06-02T09:00:00Z"),
      lastSignalRunSuccess: true,
      now,
    });
    const low = computeSystemConfidenceScore({
      totalTrades: 50,
      recentTrades: 50,
      tradesWithScoredTrader: 5,
      scoredTraderCount: 2,
      marketsWithRecentActivity: 2,
      lastTradeAt: new Date("2026-05-01T00:00:00Z"),
      lastIngestSuccessAt: null,
      lastScoreSuccessAt: null,
      lastSignalRunSuccess: false,
      now,
    });
    assert.ok(high > low);
  });
});
