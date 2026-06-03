import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReadinessBlockerDetails } from "./readiness-blockers.js";

describe("readiness blocker details", () => {
  it("maps impossible PnL to reconcile command", () => {
    const details = buildReadinessBlockerDetails([
      "3 impossible PnL trades (entry=exit, PnL≠0)",
    ]);
    assert.equal(details[0].repairCommand, "npm run reconcile:shadow-payouts");
    assert.equal(details[0].blocksLiveTrading, true);
  });

  it("maps paper validation to non-repairable ops guidance", () => {
    const details = buildReadinessBlockerDetails(["Paper validation 0 / 100"]);
    assert.equal(details[0].repairable, false);
    assert.match(details[0].repairCommand ?? "", /paper/i);
  });
});
