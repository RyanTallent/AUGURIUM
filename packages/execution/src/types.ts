export type ExecutionProviderName = "paper" | "polymarket" | "replay";

export type ExecutionMode = "PAPER" | "LIVE" | "REPLAY";

export type OrderStatus =
  | "PENDING"
  | "SUBMITTED"
  | "PARTIAL"
  | "FILLED"
  | "CANCELLED"
  | "FAILED"
  | "BLOCKED";

export interface ProviderHealth {
  ok: boolean;
  ready: boolean;
  provider: ExecutionProviderName;
  message: string;
}

export interface ProviderBalance {
  availableUsd: number;
  totalUsd: number;
}

export interface ProviderPosition {
  id: string;
  marketId: string;
  side: string;
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  status: string;
}

export interface ProviderOrder {
  id: string;
  marketId: string;
  side: string;
  status: string;
  requestedSizeUsd: number;
  filledSizeUsd: number;
}

export interface OrderRequest {
  idempotencyKey: string;
  signalId: string;
  portfolioDecisionId?: string;
  marketId: string;
  conditionId?: string | null;
  side: string;
  outcome?: string | null;
  orderType: "LIMIT" | "MARKET";
  requestedSizeUsd: number;
  requestedPrice?: number;
  asset?: string | null;
}

export interface OrderResult {
  success: boolean;
  providerOrderId?: string;
  status: OrderStatus;
  fillPrice?: number;
  filledSizeUsd?: number;
  partial?: boolean;
  errorMessage?: string;
}

export interface CredentialValidation {
  valid: boolean;
  message: string;
  configured: boolean;
}

export interface PortfolioSyncResult {
  balance: ProviderBalance;
  positions: ProviderPosition[];
  orders: ProviderOrder[];
  mismatch: boolean;
  mismatchDetails?: string[];
}

export interface ExecutionProvider {
  readonly name: ExecutionProviderName;
  readonly mode: ExecutionMode;
  healthCheck(): Promise<ProviderHealth>;
  validateCredentials(): Promise<CredentialValidation>;
  getBalance(): Promise<ProviderBalance>;
  getOpenPositions(): Promise<ProviderPosition[]>;
  getOpenOrders(): Promise<ProviderOrder[]>;
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<{ success: boolean; errorMessage?: string }>;
  closePosition(
    positionId: string,
    fraction?: number,
  ): Promise<{ success: boolean; fillPrice?: number; errorMessage?: string }>;
  syncPortfolio(): Promise<PortfolioSyncResult>;
}

export interface GateCheckInput {
  signalType: string;
  portfolioDecision: string;
  marketActive: boolean;
  marketClosed: boolean;
  hasMockSignal: boolean;
  credentialsValid: boolean;
  reconciliationOk: boolean;
  duplicateSignalOrder: boolean;
  duplicateMarketSide: boolean;
  conflictingOppositeSide: boolean;
  slippageBps: number;
  maxSlippageBps: number;
  deployedPct: number;
  maxDeployedPct: number;
  positionPct: number;
  maxPositionPct: number;
  dailyLossUsd: number;
  maxDailyLossUsd: number;
}

export interface GateCheckResult {
  allowed: boolean;
  reasons: string[];
}
