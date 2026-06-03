import type { SignalType } from "./types.js";
import { isMarketQualityAcceptable } from "./market-quality.js";

export interface WatchlistInput {
  consensusScore: number;
  alphaScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  hasScoredTraderActivity: boolean;
  insufficientData: boolean;
  uniqueTraders: number;
  disagreementScore: number;
}

export function classifySignalType(input: WatchlistInput): SignalType {
  if (input.insufficientData || !input.hasScoredTraderActivity) {
    return input.insufficientData ? "IGNORE" : "RESEARCH";
  }

  if (input.uniqueTraders < 2 && input.consensusScore < 70) {
    return "RESEARCH";
  }

  const qualityOk = isMarketQualityAcceptable(input.marketQualityScore);
  const confidenceOk = input.systemConfidenceScore >= 40;

  if (
    input.consensusScore >= 85 &&
    input.alphaScore >= 80 &&
    qualityOk &&
    confidenceOk &&
    input.uniqueTraders >= 3 &&
    input.disagreementScore < 0.35
  ) {
    return "TRADE_NOW";
  }

  const nearTradeNow =
    input.consensusScore >= 72 &&
    input.alphaScore >= 72 &&
    input.marketQualityScore >= 50 &&
    input.uniqueTraders >= 3;

  if (nearTradeNow && input.disagreementScore < 0.4) {
    return "WATCHLIST";
  }

  if (
    (input.consensusScore >= 58 && input.alphaScore >= 55 && input.uniqueTraders >= 2) ||
    (input.consensusScore >= 50 && input.uniqueTraders >= 3)
  ) {
    return "RESEARCH";
  }

  return "IGNORE";
}
