import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCopyLiveLadder,
  ladderStateAfterRung,
  type CopyLiveLadderConfig,
} from "./copy-live-ladder.js";

const cfg: CopyLiveLadderConfig = {
  enabled: true,
  rung1LeaderRoi: 0.15,
  rung1SellPctOfOriginal: 0.25,
  rung2LeaderRoi: 0.2,
  rung2SellPctOfOriginal: 0.5,
};

describe("copy live ladder", () => {
  it("triggers rung 1 at 15% leader ROI", () => {
    const action = evaluateCopyLiveLadder(
      0.16,
      { rungsCompleted: 0, remainingPct: 1, originalSizeUsd: 100 },
      cfg,
    );
    assert.equal(action?.rung, 1);
    assert.equal(action?.sellUsd, 25);
  });

  it("does not re-trigger rung 1 after completed", () => {
    const action = evaluateCopyLiveLadder(
      0.18,
      { rungsCompleted: 1, remainingPct: 0.75, originalSizeUsd: 100 },
      cfg,
    );
    assert.equal(action, null);
  });

  it("triggers rung 2 at 20% after rung 1", () => {
    const action = evaluateCopyLiveLadder(
      0.21,
      { rungsCompleted: 1, remainingPct: 0.75, originalSizeUsd: 100 },
      cfg,
    );
    assert.equal(action?.rung, 2);
    assert.equal(action?.sellUsd, 50);
  });

  it("updates remaining to 25% after both rungs", () => {
    const action = evaluateCopyLiveLadder(
      0.21,
      { rungsCompleted: 1, remainingPct: 0.75, originalSizeUsd: 100 },
      cfg,
    );
    assert.ok(action);
    const next = ladderStateAfterRung(
      { rungsCompleted: 1, remainingPct: 0.75, originalSizeUsd: 100 },
      action,
    );
    assert.equal(next.remainingPct, 0.25);
    assert.equal(next.rungsCompleted, 2);
  });
});
