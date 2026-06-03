import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDiscordConfig } from "./config.js";
import { buildSignalAlertEmbed } from "./embeds.js";
import { sendDiscordWebhook, computeRetryDelayMs } from "./dispatch.js";
import { buildWeeklyReportPayload, weekDedupeKey } from "./weekly-report.js";

describe("config", () => {
  it("disabled when DISCORD_ENABLED false", () => {
    const c = getDiscordConfig({ DISCORD_ENABLED: "false", DISCORD_WEBHOOK_URL: "https://x" });
    assert.equal(c.canSend, false);
  });

  it("skipped when webhook missing", () => {
    const c = getDiscordConfig({ DISCORD_ENABLED: "true", DISCORD_WEBHOOK_URL: "" });
    assert.equal(c.canSend, false);
  });

  it("can send when enabled and webhook set", () => {
    const c = getDiscordConfig({
      DISCORD_ENABLED: "true",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test",
    });
    assert.equal(c.canSend, true);
  });
});

describe("embeds", () => {
  it("generates signal alert with advisory fields", () => {
    const p = buildSignalAlertEmbed({
      marketTitle: "Test market",
      side: "YES",
      signalType: "WATCHLIST",
      consensusScore: 80,
      alphaScore: 75,
      marketQualityScore: 70,
      systemConfidenceScore: 60,
      triggerTraders: ["0xabc"],
      reasoning: "WATCHLIST because traders entered",
      dashboardUrl: "http://localhost:3000/signals",
    });
    assert.match(p.embeds[0].title ?? "", /WATCHLIST/);
    assert.match(p.advisoryNotice, /no live execution/i);
    assert.ok(p.embeds[0].fields?.some((f) => f.name === "Reasoning"));
  });
});

describe("dispatch", () => {
  it("skips when disabled", async () => {
    const r = await sendDiscordWebhook(
      getDiscordConfig({ DISCORD_ENABLED: "false" }),
      buildSignalAlertEmbed({
        marketTitle: "M",
        side: "YES",
        signalType: "RESEARCH",
        consensusScore: 1,
        alphaScore: 1,
        marketQualityScore: 1,
        systemConfidenceScore: 1,
        triggerTraders: [],
        reasoning: "test",
        dashboardUrl: "http://x",
      }),
    );
    assert.equal(r.status, "SKIPPED");
  });

  it("succeeds with mock fetch", async () => {
    const mockFetch = async () => new Response(null, { status: 204 });
    const r = await sendDiscordWebhook(
      getDiscordConfig({
        DISCORD_ENABLED: "true",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/x",
      }),
      buildSignalAlertEmbed({
        marketTitle: "M",
        side: "YES",
        signalType: "TRADE_NOW",
        consensusScore: 90,
        alphaScore: 85,
        marketQualityScore: 80,
        systemConfidenceScore: 70,
        triggerTraders: ["0x1"],
        reasoning: "test",
        dashboardUrl: "http://x",
      }),
      mockFetch as typeof fetch,
    );
    assert.equal(r.status, "SENT");
  });

  it("fails on HTTP error", async () => {
    const mockFetch = async () => new Response("bad", { status: 500 });
    const r = await sendDiscordWebhook(
      getDiscordConfig({
        DISCORD_ENABLED: "true",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/x",
      }),
      buildSignalAlertEmbed({
        marketTitle: "M",
        side: "YES",
        signalType: "TRADE_NOW",
        consensusScore: 90,
        alphaScore: 85,
        marketQualityScore: 80,
        systemConfidenceScore: 70,
        triggerTraders: [],
        reasoning: "test",
        dashboardUrl: "http://x",
      }),
      mockFetch as typeof fetch,
    );
    assert.equal(r.status, "FAILED");
    assert.ok(r.errorMessage?.includes("500"));
  });

  it("retry backoff grows", () => {
    assert.ok(computeRetryDelayMs(2) > computeRetryDelayMs(0));
  });
});

describe("weekly report", () => {
  it("builds payload and stable week key", () => {
    const key = weekDedupeKey(new Date("2026-06-03T12:00:00Z"));
    assert.match(key, /^weekly:/);
    const p = buildWeeklyReportPayload(
      {
        weekLabel: "2026-06-02",
        totalSignals: 10,
        signalDistribution: { RESEARCH: 8, WATCHLIST: 2 },
        shadowCount: 5,
        avgShadowRoi: 0.02,
        bestStrategy: { name: "augurium_rules", avgRoi: 0.03 },
        worstStrategy: { name: "hold", avgRoi: -0.01 },
        topTradersByRank: [],
        topTradersByCopy: [],
        emergingTraders: [],
        bestSignals: [],
        worstSignals: [],
        systemConfidence: 55,
        weaknesses: ["thin data"],
        recommendations: ["ingest more"],
      },
      "http://localhost:3000/reports",
    );
    assert.ok((p.embeds[0]?.fields?.length ?? 0) > 3);
  });
});

describe("deduplication", () => {
  it("week key is stable within same week", () => {
    const a = weekDedupeKey(new Date("2026-06-03T10:00:00Z"));
    const b = weekDedupeKey(new Date("2026-06-04T10:00:00Z"));
    assert.equal(a, b);
  });
});
