import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareShadowSyncPriority,
  resolveShadowSyncBatchSize,
  selectShadowSyncBatch,
} from "./shadow-sync-batch.js";

describe("shadow sync batch selection", () => {
  it("prioritizes open stale before open fresh", () => {
    const batch = selectShadowSyncBatch(
      [
        {
          id: "fresh",
          status: "OPEN",
          priceStatus: "FRESH",
          lastPriceUpdateAt: new Date("2026-06-02T12:00:00Z"),
          priceCheckedAt: null,
        },
        {
          id: "stale",
          status: "OPEN",
          priceStatus: "STALE",
          lastPriceUpdateAt: new Date("2026-06-01T00:00:00Z"),
          priceCheckedAt: null,
        },
      ],
      1,
    );
    assert.equal(batch[0]?.id, "stale");
  });

  it("prioritizes open before closed", () => {
    assert.ok(
      compareShadowSyncPriority(
        {
          id: "open",
          status: "OPEN",
          priceStatus: "STALE",
          lastPriceUpdateAt: null,
          priceCheckedAt: null,
        },
        {
          id: "closed",
          status: "CLOSED",
          priceStatus: "STALE",
          lastPriceUpdateAt: null,
          priceCheckedAt: null,
        },
      ) < 0,
    );
  });

  it("returns 500 when SHADOW_MAX_UPDATE=1 but SHADOW_SYNC_BATCH_SIZE unset", () => {
    assert.equal(
      resolveShadowSyncBatchSize({ SHADOW_MAX_UPDATE: "1" }),
      500,
    );
  });

  it("honors SHADOW_SYNC_BATCH_SIZE", () => {
    assert.equal(
      resolveShadowSyncBatchSize({ SHADOW_SYNC_BATCH_SIZE: "250" }),
      250,
    );
  });
});
