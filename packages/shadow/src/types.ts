export type ShadowStatus = "OPEN" | "CLOSED" | "EXPIRED";

export type TapePoint = { tradedAt: Date; price: number };

export const ENTRY_DELAYS_MS = [
  { label: "30s", ms: 30_000 },
  { label: "3m", ms: 180_000 },
  { label: "10m", ms: 600_000 },
] as const;

export const DEFAULT_ENTRY_DELAY_MS = 180_000;
export const DEFAULT_SIZE_USD = 100;

export const PARTIAL_EXIT_ROI = 0.2;
export const PARTIAL_EXIT_FRACTION = 0.85;
export const RUNNER_FRACTION = 0.15;
export const RUNNER_EXIT_ROI = 0.5;

export interface ShadowPositionState {
  simulatedEntryPrice: number;
  currentPrice: number;
  simulatedSizeUsd: number;
  positionRemaining: number;
  realizedPnl: number;
  partialExitDone: boolean;
  runnerActive: boolean;
  roi: number;
  unrealizedPnl: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
}

export interface ExitDecision {
  status: ShadowStatus;
  closeReason: string;
  latestReasoning: string;
  realizedPnl: number;
  positionRemaining: number;
  partialExitDone: boolean;
  runnerActive: boolean;
  missedProfitAfterExit: number;
  wouldHaveBeenBetterToHold: boolean;
}

export interface SimulationInput {
  strategyName: string;
  entryDelayMs: number;
  entryPrice: number;
  priceSeries: TapePoint[];
  signalCreatedAt: Date;
  signalExpiresAt: Date | null;
  marketClosed: boolean;
  simulatedSizeUsd: number;
  side: string;
}

export interface SimulationOutput {
  strategyName: string;
  entryDelayMs: number;
  entryPrice: number;
  exitPrice: number;
  roi: number;
  maxDrawdown: number;
  holdingTimeMs: number;
  outcome: "WIN" | "LOSS" | "FLAT";
}

export interface ReplayPayload {
  capturedAt: string;
  signal: Record<string, unknown>;
  market: Record<string, unknown>;
  recentTrades: Record<string, unknown>[];
  triggerTraders: Record<string, unknown>[];
  portfolioAssumption: {
    simulatedSizeUsd: number;
    entryDelayMs: number;
    entryDelayLabel: string;
  };
  scores: Record<string, number>;
  reasoning: string;
}
