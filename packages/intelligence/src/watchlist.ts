import type { SignalType } from "./types.js";
import { isMarketQualityAcceptable } from "./market-quality.js";

export interface WatchlistInput {
  consensusScore: number;
  alphaScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  hasScoredTraderActivity: boolean;
  insufficientData: boolean;
}

export function classifySignalType(input: WatchlistInput): SignalType {
  if (input.insufficientData || !input.hasScoredTraderActivity) {
    return input.insufficientData ? "IGNORE" : "RESEARCH";
  }

  const qualityOk = isMarketQualityAcceptable(input.marketQualityScore);
  const confidenceOk = input.systemConfidenceScore >= 40;

  if (
    input.consensusScore >= 85 &&
    input.alphaScore >= 80 &&
    qualityOk &&
    confidenceOk
  ) {
    return "TRADE_NOW";
  }

  const nearTradeNow =
    input.consensusScore >= 70 &&
    input.alphaScore >= 70 &&
    input.marketQualityScore >= 45;

  if (nearTradeNow || (input.consensusScore >= 70 && input.alphaScore >= 65)) {
    return "WATCHLIST";
  }

  if (input.consensusScore >= 50 || input.alphaScore >= 50) {
    return "RESEARCH";
  }

  return "IGNORE";
}
