import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isShadowSyncRunAcceptable, parseShadowSyncRunOutcome } from "./shadow-sync-health.js";

describe("readiness helpers", () => {
  it("accepts partial shadow sync with progress", () => {
    const outcome = parseShadowSyncRunOutcome({
      status: "success",
      finishedAt: new Date(),
      itemCount: 200,
      metadata: { timedOut: true, processed: 200 },
    });
    assert.equal(isShadowSyncRunAcceptable(outcome), true);
  });
});
