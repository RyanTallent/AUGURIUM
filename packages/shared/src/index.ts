/** Shared domain types for AUGURIUM */

export type MarketSource = "polymarket" | "polymarket-us";

export interface TraderScore {
  address: string;
  score: number;
  winRate: number;
  roi: number;
  sampleSize: number;
  updatedAt: Date;
}

export interface TradingSignal {
  id: string;
  marketId: string;
  side: "YES" | "NO";
  confidence: number;
  rationale: string;
  createdAt: Date;
}

export interface PortfolioAllocation {
  marketId: string;
  weight: number;
  maxExposure: number;
}

export const QUEUES = {
  MARKET_INGEST: "market:ingest",
  TRADE_INGEST: "trade:ingest",
  TRADE_LINK: "trade:link",
  WALLET_DISCOVER: "wallet:discover",
  WALLET_ACTIVITY: "wallet:activity",
  POSITION_SYNC: "position:sync",
  POSITION_RECONSTRUCT: "position:reconstruct",
  /** Phase B+ — disabled until real scoring exists */
  TRADER_SCORE: "trader:score",
  /** Phase C — real consensus signals (no execution) */
  SIGNAL_GENERATE: "signal:generate",
  /** Phase D — shadow portfolio + simulation (no execution) */
  SHADOW_SYNC: "shadow:sync",
  /** Phase E — Discord alerts (no execution) */
  DISCORD_ENQUEUE: "discord:enqueue",
  DISCORD_DISPATCH: "discord:dispatch",
  /** Phase F — portfolio / risk / allocation (simulated, no execution) */
  PORTFOLIO_RUN: "portfolio:run",
  /** Phase G — execution engine (gated; paper by default) */
  EXECUTION_RUN: "execution:run",
  /** Production self-healing (daily) */
  MAINTENANCE_DAILY: "maintenance:daily",
  /** Paper mirror of COPY-rated trader positions */
  COPY_PAPER_SYNC: "copy:paper-sync",
  /** Scan → score → sync → paper mirror (auto copy loop) */
  COPY_AUTO_PIPELINE: "copy:auto-pipeline",
  /** Precomputed web dashboard snapshots (worker) */
  WEB_SNAPSHOT_REFRESH: "web:snapshot-refresh",
  /** @deprecated use DISCORD_ENQUEUE + DISCORD_DISPATCH */
  DISCORD_NOTIFY: "discord:notify",
} as const;

/** Phase A ingestion queues (safe to run in production) */
export const INGESTION_QUEUES = [
  QUEUES.MARKET_INGEST,
  QUEUES.TRADE_INGEST,
  QUEUES.TRADE_LINK,
  QUEUES.WALLET_DISCOVER,
  QUEUES.WALLET_ACTIVITY,
  QUEUES.POSITION_SYNC,
  QUEUES.POSITION_RECONSTRUCT,
] as const;

/** Phase B — trader scoring (no signals, no execution) */
export const SCORING_QUEUES = [QUEUES.TRADER_SCORE] as const;

/** Phase C — signal generation */
export const SIGNAL_QUEUES = [QUEUES.SIGNAL_GENERATE] as const;

export type SignalTypeLabel = "TRADE_NOW" | "WATCHLIST" | "RESEARCH" | "IGNORE";

/** Phase D — shadow portfolio */
export const SHADOW_QUEUES = [QUEUES.SHADOW_SYNC] as const;

/** Phase E — Discord */
export const DISCORD_QUEUES = [QUEUES.DISCORD_ENQUEUE, QUEUES.DISCORD_DISPATCH] as const;

/** Phase F — portfolio engine */
export const PORTFOLIO_QUEUES = [QUEUES.PORTFOLIO_RUN] as const;

/** Phase G — execution */
export const EXECUTION_QUEUES = [QUEUES.EXECUTION_RUN] as const;

export const MAINTENANCE_QUEUES = [QUEUES.MAINTENANCE_DAILY] as const;

/** Copy-trading paper mirror */
export const COPY_TRADING_QUEUES = [
  QUEUES.COPY_PAPER_SYNC,
  QUEUES.COPY_AUTO_PIPELINE,
] as const;

/** Web snapshot refresh (offloads Render web memory) */
export const WEB_SNAPSHOT_QUEUES = [QUEUES.WEB_SNAPSHOT_REFRESH] as const;

/** Phase A + B + C + D + E + F + G worker tick queues */
export const WORKER_QUEUES = [
  ...INGESTION_QUEUES,
  ...SCORING_QUEUES,
  ...SIGNAL_QUEUES,
  ...SHADOW_QUEUES,
  ...DISCORD_QUEUES,
  ...PORTFOLIO_QUEUES,
  ...EXECUTION_QUEUES,
  ...MAINTENANCE_QUEUES,
  ...COPY_TRADING_QUEUES,
  ...WEB_SNAPSHOT_QUEUES,
] as const;

export type TraderTierLabel =
  | "PROSPECT"
  | "RISING"
  | "ELITE"
  | "SUPER_ELITE"
  | "UNRANKED";

export const SYNC_STREAMS = {
  GLOBAL_TRADES: "polymarket:trades:global",
  walletActivity: (address: string) =>
    `polymarket:activity:${address.toLowerCase()}`,
} as const;

export const APP_NAME = "AUGURIUM";

export {
  getDiscordConfig,
  discordChannelForEventType,
  resolveDiscordWebhookUrl,
  canSendDiscordToChannel,
  type DiscordConfig,
  type DiscordEnvConfig,
  type DiscordWebhookChannel,
} from "./discord-config.js";
export { isUsOnlyLiveCopyMode, usePolymarketScanIntel, requirePolymarketUsForLiveCopy, isUsBroadIntelMode, getUsCompatMinConfidence, shouldTryGlobalSlugOnUs, shouldRelaxUsSlugMatch } from "./us-copy-mode.js";
