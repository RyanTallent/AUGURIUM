import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDiscordConfig } from "./config.js";

describe("Discord env status", () => {
  it("reports disabled without env", () => {
    const c = getDiscordConfig({});
    assert.equal(c.enabled, false);
    assert.equal(c.canSend, false);
  });

  it("reports ready when enabled and webhook set", () => {
    const c = getDiscordConfig({
      DISCORD_ENABLED: "true",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    });
    assert.equal(c.enabled, true);
    assert.equal(c.canSend, true);
  });
});
