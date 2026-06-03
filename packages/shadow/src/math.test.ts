import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { priceAtOrAfter } from "./math.js";

describe("priceAtOrAfter", () => {
  it("returns null when only pre-target trades exist", () => {
    const tape = [{ tradedAt: new Date("2026-01-01T10:00:00Z"), price: 0.4 }];
    const target = Date.parse("2026-01-01T12:00:00Z");
    assert.equal(priceAtOrAfter(tape, target), null);
  });

  it("returns first post-target price", () => {
    const tape = [
      { tradedAt: new Date("2026-01-01T10:00:00Z"), price: 0.4 },
      { tradedAt: new Date("2026-01-01T12:05:00Z"), price: 0.55 },
    ];
    const target = Date.parse("2026-01-01T12:00:00Z");
    assert.equal(priceAtOrAfter(tape, target), 0.55);
  });
});
