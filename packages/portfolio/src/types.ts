export type PortfolioDecisionType =
  | "ACCEPT"
  | "WATCH"
  | "REJECT"
  | "SCALE"
  | "REDUCE"
  | "REALLOCATE";

export type CapitalLedgerType =
  | "INITIAL_BANKROLL"
  | "REALIZED_PROFIT"
  | "REALIZED_LOSS"
  | "RESERVE_TRANSFER"
  | "REINVESTMENT"
  | "SIMULATED_ALLOCATION";

export interface SignalInputs {
  signalId: string;
  marketId: string;
  signalType: string;
  side: string;
  alphaScore: number;
  consensusScore: number;
  systemConfidenceScore: number;
  marketQualityScore: number;
  disagreementScore: number;
  category: string | null;
  liquidityScore: number;
  slippageEstimate: number;
  staleSignal: boolean;
  sparseData: boolean;
}

export interface OpenPositionView {
  id: string;
  signalId: string;
  marketId: string;
  category: string | null;
  compositeScore: number;
  allocatedUsd: number;
  positionPct: number;
}

export interface PortfolioContext {
  tradingBankroll: number;
  deployedCapital: number;
  drawdownMode: boolean;
  currentDrawdown: number;
  openPositions: OpenPositionView[];
  dailyLossUsd: number;
}

export interface AllocationResult {
  decision: PortfolioDecisionType;
  compositeScore: number;
  riskScore: number;
  recommendedSizeUsd: number;
  recommendedPct: number;
  reasons: string[];
  reallocationTargetId: string | null;
  capViolation: boolean;
}

export interface ProfitSplit {
  reinvestUsd: number;
  reserveUsd: number;
}
