export type TraderTier = "PROSPECT" | "RISING" | "ELITE" | "SUPER_ELITE" | "UNRANKED";

export interface TradeInput {
  id: string;
  side: string;
  size: number;
  price: number;
  tradedAt: Date;
  conditionId: string;
  asset: string;
  marketId: string | null;
  category: string | null;
}

export interface TapePoint {
  tradedAt: Date;
  price: number;
}

export interface PositionInput {
  pnl: number;
  size: number;
  avgPrice: number;
  status: string;
  category: string | null;
}

export interface RealizedRoundTrip {
  pnl: number;
  notional: number;
  won: boolean;
  closedAt: Date;
  category: string | null;
}

export interface CopyabilityDelayMs {
  label: string;
  ms: number;
}

export const COPY_DELAYS: CopyabilityDelayMs[] = [
  { label: "30s", ms: 30_000 },
  { label: "3m", ms: 180_000 },
  { label: "10m", ms: 600_000 },
];

export interface TraderMetricsResult {
  tradeCount: number;
  marketCount: number;
  totalVolume: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  activeDays: number;
  averageTradeSize: number;
  averagePositionSize: number;
  realizedPnl: number;
  unrealizedPnl: number;
  estimatedTotalPnl: number;
  roi: number;
  winRate: number;
  lossRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  consistencyScore: number;
  roi7d: number;
  roi30d: number;
  roi90d: number;
  roi180d: number;
  volume7d: number;
  volume30d: number;
  tradeCount7d: number;
  tradeCount30d: number;
  copyabilityScore: number;
  estimatedCopiedRoi: number;
  averageSlippageEstimate: number;
  averageExecutionDelayEstimate: number;
  mirrorabilityScore: number;
  copiedProfitFactor: number;
  informationEdgeScore: number;
  confidenceScore: number;
  recentFormScore: number;
  rankingScore: number;
  tier: TraderTier;
  bestCategory: string | null;
  specialistCategory: string | null;
  specialistScore: number;
  lowConfidence: boolean;
  skipReason: string | null;
  categoryMetrics: CategoryMetricResult[];
}

export interface CategoryMetricResult {
  category: string;
  tradeCount: number;
  volume: number;
  roi: number;
  winRate: number;
  specialistScore: number;
}
