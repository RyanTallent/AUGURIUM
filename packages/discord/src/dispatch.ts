import type { DiscordConfig } from "./config.js";
import { discordChannelForEventType, resolveDiscordWebhookUrl } from "@augurium/shared";
import type { DiscordEventPayload, DiscordWebhookPayload } from "./types.js";

export interface DispatchResult {
  ok: boolean;
  status: "SENT" | "SKIPPED" | "FAILED";
  errorMessage?: string;
}

export interface SendDiscordOptions {
  eventType?: string;
  webhookUrl?: string;
}

export async function sendDiscordWebhook(
  config: DiscordConfig,
  payload: DiscordEventPayload,
  fetchImpl: typeof fetch = fetch,
  options: SendDiscordOptions | string = {},
): Promise<DispatchResult> {
  const opts: SendDiscordOptions =
    typeof options === "string" ? { webhookUrl: options } : options;

  if (!config.enabled) {
    return { ok: false, status: "SKIPPED", errorMessage: "DISCORD_ENABLED is false" };
  }

  const channel = opts.eventType ? discordChannelForEventType(opts.eventType) : "DEFAULT";
  const targetUrl = (
    opts.webhookUrl ??
    resolveDiscordWebhookUrl(config, channel)
  ).trim();

  if (!targetUrl) {
    return {
      ok: false,
      status: "SKIPPED",
      errorMessage: `Discord webhook missing for channel ${channel}`,
    };
  }

  const body: DiscordWebhookPayload = { embeds: payload.embeds };

  try {
    const res = await fetchImpl(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: "FAILED",
        errorMessage: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    return { ok: true, status: "SENT" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: "FAILED", errorMessage: message };
  }
}

export function computeRetryDelayMs(retryCount: number): number {
  const base = 60_000;
  return Math.min(base * 2 ** retryCount, 30 * 60_000);
}
