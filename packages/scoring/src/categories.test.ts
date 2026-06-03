import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketCategory, formatSpecialistLabel } from "./categories.js";

describe("category classification", () => {
  it("maps gamma politics category", () => {
    assert.equal(normalizeMarketCategory({ gammaCategory: "politics" }), "Politics");
  });

  it("classifies crypto from title keywords", () => {
    assert.equal(
      normalizeMarketCategory({ title: "Will Bitcoin hit $100k in 2026?" }),
      "Crypto",
    );
  });

  it("falls back to Other", () => {
    assert.equal(normalizeMarketCategory({ title: "Miscellaneous outcome" }), "Other");
  });

  it("formats specialist label", () => {
    assert.equal(formatSpecialistLabel("Crypto"), "Crypto Specialist");
    assert.equal(formatSpecialistLabel("Other"), null);
  });
});
