export type SignalType = "TRADE_NOW" | "WATCHLIST" | "RESEARCH" | "IGNORE";

export interface TraderSignalProfile {
  rankingScore: number;
  estimatedCopiedRoi: number;
  copyabilityScore: number;
  informationEdgeScore: number;
  confidenceScore: number;
  recentFormScore: number;
  tier: string;
  lowConfidence: boolean;
}

export interface ConsensusTradeInput {
  tradeId: string;
  wallet: string;
  marketId: string;
  conditionId: string;
  side: string;
  outcome: string | null;
  size: number;
  price: number;
  tradedAt: Date;
  trader: TraderSignalProfile;
}

export interface MarketQualityInput {
  marketId: string;
  active: boolean;
  closed: boolean;
  resolved: boolean;
  acceptingOrders: boolean | null;
  endDate: Date | null;
  recentTrades: { price: number; size: number; tradedAt: Date }[];
  volume7d: number;
  tradeCount7d: number;
  tradeCount24h: number;
  uniqueTraders7d: number;
}

export interface SideConsensusResult {
  outcomeSide: string;
  consensusScore: number;
  copyabilityScore: number;
  informationEdgeScore: number;
  convictionScore: number;
  disagreementScore: number;
  opposingConsensus: number;
  tradeCount: number;
  triggerTradeIds: string[];
  triggerTraderWallets: string[];
  medianCopiedRoi: number;
  combinedNotional: number;
  oldestTriggerTradeAt: Date | null;
  newestTriggerTradeAt: Date | null;
}

export interface MarketSignalEvaluation {
  marketId: string;
  conditionId: string | null;
  category: string | null;
  outcomeSide: string;
  consensus: SideConsensusResult;
  opposingConsensus: number;
  marketQualityScore: number;
  alphaScore: number;
  systemConfidenceScore: number;
  signalType: SignalType;
  baseSignalType: SignalType;
  promotionReasons: string[];
  classificationMeta: Record<string, unknown>;
  reasoning: string;
  skipReason: string | null;
  evidenceWindowMinutes: number;
}

export interface SystemConfidenceInput {
  totalTrades: number;
  recentTrades: number;
  tradesWithScoredTrader: number;
  scoredTraderCount: number;
  marketsWithRecentActivity: number;
  lastTradeAt: Date | null;
  lastIngestSuccessAt: Date | null;
  lastScoreSuccessAt: Date | null;
  lastSignalRunSuccess: boolean;
  categorizedMarketsPct?: number;
  shadowPriceFreshPct?: number;
  tapeCoveragePct?: number;
  now: Date;
}
