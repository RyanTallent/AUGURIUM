/** Shared domain types for AUGURIUM */

export type MarketSource = "polymarket";

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
  TRADER_SCORE: "trader:score",
  SIGNAL_GENERATE: "signal:generate",
  DISCORD_NOTIFY: "discord:notify",
} as const;

export const APP_NAME = "AUGURIUM";
