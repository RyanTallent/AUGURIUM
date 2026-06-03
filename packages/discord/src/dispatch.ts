import type { DiscordConfig } from "./config.js";
import type { DiscordEventPayload, DiscordWebhookPayload } from "./types.js";

export interface DispatchResult {
  ok: boolean;
  status: "SENT" | "SKIPPED" | "FAILED";
  errorMessage?: string;
}

export async function sendDiscordWebhook(
  config: DiscordConfig,
  payload: DiscordEventPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  if (!config.enabled) {
    return { ok: false, status: "SKIPPED", errorMessage: "DISCORD_ENABLED is false" };
  }
  if (!config.webhookUrl) {
    return { ok: false, status: "SKIPPED", errorMessage: "DISCORD_WEBHOOK_URL missing" };
  }

  const body: DiscordWebhookPayload = { embeds: payload.embeds };

  try {
    const res = await fetchImpl(config.webhookUrl, {
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
