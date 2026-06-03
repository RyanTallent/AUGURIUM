export interface DiscordConfig {
  enabled: boolean;
  webhookUrl: string;
  canSend: boolean;
  dashboardBaseUrl: string;
}

export function getDiscordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig {
  const enabled =
    env.DISCORD_ENABLED === "true" ||
    env.DISCORD_ENABLED === "1" ||
    env.DISCORD_ENABLED === "yes";
  const webhookUrl = (env.DISCORD_WEBHOOK_URL ?? "").trim();
  const dashboardBaseUrl = (env.AUGURIUM_DASHBOARD_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  return {
    enabled,
    webhookUrl,
    canSend: enabled && webhookUrl.length > 0,
    dashboardBaseUrl,
  };
}
