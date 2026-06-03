import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeConfidenceScore } from "./confidence.js";
import { computeCopyability } from "./copyability.js";
import { computeInformationEdgeScore } from "./information-edge.js";
import { classifyTier, computeRankingScore } from "./ranking.js";
import {
  computeRealizedRoundTrips,
  profitFactorFromTrips,
  winRateFromTrips,
} from "./round-trips.js";
import { computeCategoryMetrics } from "./category.js";
import { computeTraderMetrics } from "./compute.js";
import { safeDivide } from "./math.js";
import type { TapePoint, TradeInput } from "./types.js";

const base: Omit<TradeInput, "id" | "side" | "size" | "price" | "tradedAt"> = {
  conditionId: "0xabc",
  asset: "token1",
  marketId: "m1",
  category: "politics",
};

describe("roi", () => {
  it("computes ROI from pnl over volume", () => {
    const pnl = 20;
    const vol = 100;
    assert.equal(safeDivide(pnl, vol, 0), 0.2);
  });

  it("computes trader ROI from metrics", () => {
    const trades: TradeInput[] = [
      { id: "1", side: "BUY", size: 100, price: 0.4, tradedAt: new Date("2026-01-01"), ...base },
      { id: "2", side: "SELL", size: 100, price: 0.6, tradedAt: new Date("2026-01-02"), ...base },
      { id: "3", side: "BUY", size: 50, price: 0.3, tradedAt: new Date("2026-01-03"), ...base },
      { id: "4", side: "SELL", size: 50, price: 0.5, tradedAt: new Date("2026-01-04"), ...base },
      { id: "5", side: "BUY", size: 20, price: 0.2, tradedAt: new Date("2026-01-05"), ...base },
      { id: "6", side: "SELL", size: 20, price: 0.4, tradedAt: new Date("2026-01-06"), ...base },
    ];
    const m = computeTraderMetrics(trades, [], new Map());
    assert.equal(m.skipReason, null);
    assert.ok(m.roi > 0);
    assert.ok(m.winRate > 0);
  });
});

describe("round trips", () => {
  it("computes win rate and profit factor", () => {
    const trades: TradeInput[] = [
      { id: "1", side: "BUY", size: 10, price: 0.4, tradedAt: new Date("2026-01-01"), ...base },
      { id: "2", side: "SELL", size: 10, price: 0.6, tradedAt: new Date("2026-01-02"), ...base },
      { id: "3", side: "BUY", size: 5, price: 0.5, tradedAt: new Date("2026-01-03"), ...base },
      { id: "4", side: "SELL", size: 5, price: 0.3, tradedAt: new Date("2026-01-04"), ...base },
    ];
    const trips = computeRealizedRoundTrips(trades);
    assert.ok(trips.length >= 2);
    assert.ok(winRateFromTrips(trips) >= 0 && winRateFromTrips(trips) <= 1);
    assert.ok(profitFactorFromTrips(trips) >= 0);
  });
});

describe("confidence", () => {
  it("caps low sample traders", () => {
    const low = computeConfidenceScore({
      tradeCount: 15,
      activeDays: 10,
      marketCount: 3,
      totalVolume: 300,
      consistencyScore: 0.8,
      lastSeen: new Date(),
      now: new Date(),
    });
    const high = computeConfidenceScore({
      tradeCount: 400,
      activeDays: 90,
      marketCount: 30,
      totalVolume: 50000,
      consistencyScore: 0.7,
      lastSeen: new Date(),
      now: new Date(),
    });
    assert.ok(high.score > low.score);
    assert.ok(low.score <= 0.25);
  });
});

describe("copyability", () => {
  it("rewards persistent edge after delay", () => {
    const tape: TapePoint[] = [
      { tradedAt: new Date("2026-01-01T00:00:00Z"), price: 0.4 },
      { tradedAt: new Date("2026-01-01T00:01:00Z"), price: 0.45 },
      { tradedAt: new Date("2026-01-01T00:05:00Z"), price: 0.55 },
    ];
    const tapes = new Map([["0xabc:token1", tape]]);
    const trades: TradeInput[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      side: "BUY",
      size: 50,
      price: 0.4,
      tradedAt: new Date(`2026-01-01T00:${String(i).padStart(2, "0")}:00Z`),
      ...base,
    }));
    const result = computeCopyability(trades, tapes, {
      tradeCount: trades.length,
      totalVolume: 600,
    });
    assert.ok(result.copyabilityScore > 0.4);
  });
});

describe("information edge", () => {
  it("detects favorable post-entry drift", () => {
    const tape: TapePoint[] = [
      { tradedAt: new Date("2026-01-01T00:00:00Z"), price: 0.3 },
      { tradedAt: new Date("2026-01-01T00:10:00Z"), price: 0.5 },
      { tradedAt: new Date("2026-01-01T01:00:00Z"), price: 0.7 },
    ];
    const trades: TradeInput[] = [
      { id: "1", side: "BUY", size: 5, price: 0.3, tradedAt: new Date("2026-01-01T00:00:00Z"), ...base },
    ];
    const edge = computeInformationEdgeScore(trades, new Map([["0xabc:token1", tape]]));
    assert.ok(edge > 0.6);
  });
});

describe("ranking", () => {
  it("weights copied ROI over raw ROI", () => {
    const highCopy = computeRankingScore({
      estimatedCopiedRoi: 0.15,
      copyabilityScore: 0.9,
      informationEdgeScore: 0.7,
      confidenceScore: 0.8,
      consistencyScore: 0.7,
      recentFormScore: 0.6,
    });
    const lowCopy = computeRankingScore({
      estimatedCopiedRoi: -0.05,
      copyabilityScore: 0.2,
      informationEdgeScore: 0.3,
      confidenceScore: 0.8,
      consistencyScore: 0.7,
      recentFormScore: 0.9,
    });
    assert.ok(highCopy > lowCopy);
  });
});

describe("tiers", () => {
  it("classifies emerging traders", () => {
    const tier = classifyTier({
      tradeCount: 40,
      rankingScore: 62,
      roi30d: 0.12,
      copyabilityScore: 0.7,
      informationEdgeScore: 0.65,
      confidenceScore: 0.5,
      lowConfidence: false,
    });
    assert.equal(tier, "RISING");
  });
});

describe("category specialists", () => {
  it("finds dominant category", () => {
    const trades: TradeInput[] = [
      { id: "1", side: "BUY", size: 10, price: 0.5, tradedAt: new Date("2026-01-01"), ...base, category: "Crypto" },
      { id: "2", side: "SELL", size: 10, price: 0.7, tradedAt: new Date("2026-01-02"), ...base, category: "Crypto" },
      { id: "3", side: "BUY", size: 2, price: 0.4, tradedAt: new Date("2026-01-03"), ...base, category: "Sports" },
    ];
    const trips = computeRealizedRoundTrips(trades);
    const cats = computeCategoryMetrics(trades, trips);
    assert.equal(cats[0].category, "Crypto");
    assert.ok(cats[0].tradeCount >= 2);
  });
});
