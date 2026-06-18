/** Env-only Discord configuration (no webhook I/O). Safe for web and worker. */

export type DiscordWebhookChannel =
  | "TRADE_ENTER"
  | "TRADE_EXIT"
  | "TRADE_PROBLEM"
  | "PORTFOLIO_HEALTH"
  | "BRAIN"
  | "RISK"
  | "JOURNAL"
  | "DEFAULT";

export interface DiscordEnvConfig {
  enabled: boolean;
  webhookUrl: string;
  canSend: boolean;
  dashboardBaseUrl: string;
  webhooks: Record<DiscordWebhookChannel, string>;
}

export type DiscordConfig = DiscordEnvConfig;

const CHANNEL_ENV: Record<DiscordWebhookChannel, string | null> = {
  TRADE_ENTER: "DISCORD_WEBHOOK_TRADE_ENTER",
  TRADE_EXIT: "DISCORD_WEBHOOK_TRADE_EXIT",
  TRADE_PROBLEM: "DISCORD_WEBHOOK_TRADE_PROBLEM",
  PORTFOLIO_HEALTH: "DISCORD_WEBHOOK_PORTFOLIO_HEALTH",
  BRAIN: "DISCORD_WEBHOOK_BRAIN",
  RISK: "DISCORD_WEBHOOK_RISK",
  JOURNAL: "DISCORD_WEBHOOK_JOURNAL",
  DEFAULT: "DISCORD_WEBHOOK_URL",
};

/** Route Discord event types to webhook channels. */
export function discordChannelForEventType(eventType: string): DiscordWebhookChannel {
  switch (eventType) {
    case "EXECUTION_LIVE":
      return "TRADE_ENTER";
    case "COPY_LIVE_CLOSED":
    case "COPY_LIVE_PARTIAL":
      return "TRADE_EXIT";
    case "EXECUTION_BLOCKED":
    case "EXECUTION_ERROR":
      return "TRADE_PROBLEM";
    case "PORTFOLIO_HEALTH":
    case "WORKER_ONLINE":
    case "SCAN_COMPLETE":
      return "PORTFOLIO_HEALTH";
    case "BRAIN_UPDATE":
    case "FUNNEL_WARNING":
    case "DB_PRESSURE_WARNING":
    case "INVESTMENT_JOURNAL":
      return "BRAIN";
    case "RISK_ALERT":
    case "COPY_WEEKLY_STOP":
      return "RISK";
    case "JOURNAL_ENTRY":
      return "JOURNAL";
    default:
      return "DEFAULT";
  }
}

function readWebhook(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim();
}

export function getDiscordConfig(env: Record<string, string | undefined>): DiscordEnvConfig {
  const enabled =
    env.DISCORD_ENABLED === "true" ||
    env.DISCORD_ENABLED === "1" ||
    env.DISCORD_ENABLED === "yes";
  const fallback = readWebhook(env, "DISCORD_WEBHOOK_URL");
  const dashboardBaseUrl = (env.AUGURIUM_DASHBOARD_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  const webhooks = {} as Record<DiscordWebhookChannel, string>;
  for (const [channel, envKey] of Object.entries(CHANNEL_ENV)) {
    const ch = channel as DiscordWebhookChannel;
    const specific = envKey ? readWebhook(env, envKey) : "";
    webhooks[ch] = specific || fallback;
  }

  const webhookUrl = webhooks.DEFAULT;

  return {
    enabled,
    webhookUrl,
    canSend: enabled && Object.values(webhooks).some((u) => u.length > 0),
    dashboardBaseUrl,
    webhooks,
  };
}

export function resolveDiscordWebhookUrl(
  config: DiscordEnvConfig,
  channel: DiscordWebhookChannel,
): string {
  const url = config.webhooks[channel];
  if (url) return url;
  return config.webhooks.DEFAULT;
}

export function canSendDiscordToChannel(
  config: DiscordEnvConfig,
  channel: DiscordWebhookChannel,
): boolean {
  return config.enabled && resolveDiscordWebhookUrl(config, channel).length > 0;
}
