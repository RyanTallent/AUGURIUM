import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPaginationOffsetExhausted,
  parseOffsetFromUrl,
} from "./polymarket-pagination.js";

describe("polymarket pagination", () => {
  it("treats 400/422 at offset>0 as exhausted", () => {
    assert.equal(isPaginationOffsetExhausted(400, 100), true);
    assert.equal(isPaginationOffsetExhausted(422, 50), true);
    assert.equal(isPaginationOffsetExhausted(400, 0), false);
    assert.equal(isPaginationOffsetExhausted(500, 100), false);
  });

  it("parses offset from URL", () => {
    assert.equal(parseOffsetFromUrl("https://data-api.polymarket.com/trades?limit=100&offset=250"), 250);
    assert.equal(parseOffsetFromUrl("https://gamma-api.polymarket.com/markets?limit=50"), 0);
  });
});
