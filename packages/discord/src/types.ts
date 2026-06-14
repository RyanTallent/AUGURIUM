export type DiscordEventStatus = "PENDING" | "SENT" | "SKIPPED" | "FAILED";

export type DiscordEventType =
  | "SIGNAL_ALERT"
  | "HIGH_CONVICTION_SIGNAL"
  | "TRADE_NOW"
  | "SHADOW_OPENED"
  | "SHADOW_WINNER"
  | "SHADOW_LOSER"
  | "SHADOW_PARTIAL_PROFIT"
  | "SHADOW_RUNNER_CREATED"
  | "SHADOW_RUNNER_EXIT"
  | "SHADOW_CLOSED"
  | "SHADOW_MISSED_PROFIT"
  | "TRADER_EMERGING"
  | "TRADER_RISING"
  | "TRADER_HIGH_COPYABILITY"
  | "COPY_BOARD_CHANGED"
  | "TRADER_INFORMATION_EDGE"
  | "RISK_SYSTEM"
  | "WEEKLY_REPORT"
  | "PORTFOLIO_DECISION"
  | "PORTFOLIO_RISK"
  | "PORTFOLIO_REALLOCATE"
  | "EXECUTION_PAPER"
  | "EXECUTION_LIVE"
  | "EXECUTION_BLOCKED"
  | "EXECUTION_ERROR"
  | "EXECUTION_RECONCILIATION"
  | "COPY_LIVE_CLOSED"
  | "COPY_LIVE_PARTIAL"
  | "PORTFOLIO_HEALTH";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  url?: string;
}

export interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

export interface DiscordEventPayload {
  embeds: DiscordEmbed[];
  advisoryNotice: string;
  meta?: Record<string, unknown>;
}
