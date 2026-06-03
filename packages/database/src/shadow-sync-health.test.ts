import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isShadowSyncRunAcceptable,
  parseShadowSyncRunOutcome,
} from "./shadow-sync-health.js";

describe("shadow sync health", () => {
  it("treats partial timeout as acceptable", () => {
    const outcome = parseShadowSyncRunOutcome({
      status: "success",
      finishedAt: new Date(),
      itemCount: 311,
      metadata: { timedOut: true, processed: 311, selected: 490 },
    });
    assert.equal(outcome?.partialTimeout, true);
    assert.equal(isShadowSyncRunAcceptable(outcome), true);
  });

  it("treats empty timeout as not acceptable", () => {
    const outcome = parseShadowSyncRunOutcome({
      status: "error",
      finishedAt: new Date(),
      itemCount: 0,
      metadata: { timedOut: true, processed: 0 },
    });
    assert.equal(isShadowSyncRunAcceptable(outcome), false);
  });
});
