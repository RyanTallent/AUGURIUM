import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateClosedPayout } from "@augurium/shadow";

describe("readiness payout gates", () => {
  it("fails on entry equals exit nonzero pnl", () => {
    const v = validateClosedPayout({
      entryPrice: 0.025,
      exitPrice: 0.025,
      costBasis: 100,
      realizedPnl: 3800,
      outcomeSide: "YES",
      formula: "mark_to_market",
      partialExitDone: false,
      positionRemainingAtClose: 0,
      priorRealizedPnl: 0,
    });
    assert.equal(v.valid, false);
  });

  it("accepts partial shadow sync health", async () => {
    const { isShadowSyncRunAcceptable, parseShadowSyncRunOutcome } = await import(
      "./shadow-sync-health.js"
    );
    const outcome = parseShadowSyncRunOutcome({
      status: "success",
      finishedAt: new Date(),
      itemCount: 100,
      metadata: { timedOut: true, processed: 100 },
    });
    assert.equal(isShadowSyncRunAcceptable(outcome), true);
  });
});
