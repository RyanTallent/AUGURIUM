import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickTradersForScoring, shouldRescoreTrader } from "./score-traders-select.js";

describe("pickTradersForScoring", () => {
  const now = new Date("2026-06-02T12:00:00Z");

  it("prefers unscored wallets before rescore", () => {
    const picked = pickTradersForScoring(
      [{ id: "a", trades: 10, lastScoredAt: null, lastActivityAt: now }],
      [{ id: "b", trades: 20, lastScoredAt: new Date("2026-06-01T00:00:00Z"), lastActivityAt: now }],
      {
        batchSize: 1,
        minTrades: 5,
        rescoreCooldownMs: 60_000,
        lowValueMaxTrades: 15,
        lowValueRescoreCooldownMs: 3600_000,
        now,
      },
    );
    assert.equal(picked[0]?.id, "a");
  });

  it("skips rescore when activity unchanged", () => {
    const scoredAt = new Date("2026-06-01T00:00:00Z");
    assert.equal(
      shouldRescoreTrader(
        { trades: 20, lastScoredAt: scoredAt, lastActivityAt: scoredAt },
        {
          rescoreCooldownMs: 60_000,
          lowValueMaxTrades: 15,
          lowValueRescoreCooldownMs: 3600_000,
          now,
        },
      ),
      false,
    );
  });
});
