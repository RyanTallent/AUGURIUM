import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUsCompatMinConfidence, isUsBroadIntelMode } from "./us-copy-mode.js";

describe("getUsCompatMinConfidence", () => {
  const usLiveEnv = {
    EXECUTION_PROVIDER: "polymarket-us",
    LIVE_COPY_ENABLED: "true",
  };

  it("defaults to 0.9", () => {
    assert.equal(getUsCompatMinConfidence(usLiveEnv), 0.9);
  });

  it("honors US_COMPAT_MIN_CONFIDENCE even when broad intel is on", () => {
    assert.equal(
      getUsCompatMinConfidence({ ...usLiveEnv, COPY_US_BROAD_INTEL: "true", US_COMPAT_MIN_CONFIDENCE: "0.90" }),
      0.9,
    );
  });

  it("honors explicit lower thresholds when set", () => {
    assert.equal(
      getUsCompatMinConfidence({ ...usLiveEnv, US_COMPAT_MIN_CONFIDENCE: "0.85" }),
      0.85,
    );
  });
});

describe("isUsBroadIntelMode", () => {
  it("defaults off for US live copy", () => {
    assert.equal(
      isUsBroadIntelMode({
        EXECUTION_PROVIDER: "polymarket-us",
        LIVE_COPY_ENABLED: "true",
      }),
      false,
    );
  });

  it("enabled only when explicitly set", () => {
    assert.equal(
      isUsBroadIntelMode({
        EXECUTION_PROVIDER: "polymarket-us",
        LIVE_COPY_ENABLED: "true",
        COPY_US_BROAD_INTEL: "true",
      }),
      true,
    );
  });
});
