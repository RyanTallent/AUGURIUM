import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveShadowPrice } from "./price-update.js";

describe("shadow price updates", () => {
  it("marks fresh post-entry tape price", () => {
    const entryMs = Date.parse("2026-06-01T12:00:00Z");
    const result = resolveShadowPrice({
      entryMs,
      entryPrice: 0.4,
      side: "YES",
      tape: [
        { tradedAt: new Date("2026-06-01T12:00:00Z"), price: 0.4 },
        { tradedAt: new Date("2026-06-01T12:05:00Z"), price: 0.55 },
      ],
      now: new Date("2026-06-01T12:10:00Z"),
    });
    assert.equal(result.priceStatus, "FRESH");
    assert.equal(result.currentPrice, 0.55);
    assert.ok(result.currentPrice > 0.4);
  });

  it("reports no price source without tape", () => {
    const result = resolveShadowPrice({
      entryMs: Date.parse("2026-06-01T12:00:00Z"),
      entryPrice: 0.5,
      side: "YES",
      tape: [],
    });
    assert.equal(result.priceStatus, "NO_PRICE_SOURCE");
    assert.equal(result.priceSource, "ENTRY_FALLBACK");
  });
});
