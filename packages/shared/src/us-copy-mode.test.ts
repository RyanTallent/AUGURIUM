import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUsBroadIntelMode, isUsOnlyArchitecture, usePolymarketScanIntel } from "./us-copy-mode.js";

const usLiveEnv = {
  EXECUTION_PROVIDER: "polymarket-us",
  LIVE_COPY_ENABLED: "true",
};

describe("isUsOnlyArchitecture", () => {
  it("defaults on for US live copy", () => {
    assert.equal(isUsOnlyArchitecture(usLiveEnv), true);
  });

  it("can be disabled explicitly", () => {
    assert.equal(
      isUsOnlyArchitecture({ ...usLiveEnv, COPY_US_ONLY_ARCHITECTURE: "false" }),
      false,
    );
  });
});

describe("usePolymarketScanIntel", () => {
  it("defaults off for US live copy", () => {
    assert.equal(usePolymarketScanIntel(usLiveEnv), false);
  });

  it("enabled only when explicitly set", () => {
    assert.equal(usePolymarketScanIntel({ ...usLiveEnv, COPY_INTEL_SOURCE: "polymarketscan" }), true);
  });
});

describe("isUsBroadIntelMode", () => {
  it("defaults off under US-only architecture", () => {
    assert.equal(isUsBroadIntelMode(usLiveEnv), false);
  });
});
