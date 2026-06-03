import type { SignalType } from "./types.js";
import type { WatchlistInput } from "./watchlist.js";
import { classifySignalType } from "./watchlist.js";
import { isMarketQualityAcceptable } from "./market-quality.js";
import {
  evaluateSignalEvidence,
  type SignalEvidenceInput,
} from "./evidence.js";

export function tradeNowClassificationFailures(input: WatchlistInput): string[] {
  const failures: string[] = [];
  if (input.insufficientData) failures.push("insufficient_data");
  if (!input.hasScoredTraderActivity) failures.push("no_scored_trader_activity");
  if (input.uniqueTraders < 3) failures.push("insufficient_traders");
  if (input.consensusScore < 85) failures.push("low_consensus");
  if (input.alphaScore < 80) failures.push("low_alpha");
  if (!isMarketQualityAcceptable(input.marketQualityScore)) failures.push("low_market_quality");
  if (input.systemConfidenceScore < 40) failures.push("low_system_confidence");
  if (input.disagreementScore >= 0.35) failures.push("high_disagreement");
  return failures;
}

export function evidencePromotionFailures(
  evidence: ReturnType<typeof evaluateSignalEvidence>,
  input: SignalEvidenceInput,
): string[] {
  const failures: string[] = [];
  const traders = input.consensus.triggerTraderWallets.length;
  const notional = input.consensus.combinedNotional ?? 0;

  if (!evidence.sufficientForWatchlist) {
    failures.push("insufficient_watchlist_evidence");
  }
  if (!evidence.sufficientForTradeNow) {
    if (traders < 3) failures.push("insufficient_traders");
    if (notional < 1000) failures.push("insufficient_volume");
    if (input.marketQualityScore < 55) failures.push("low_market_quality");
    if (input.systemConfidenceScore < 50) failures.push("low_confidence");
    if (!evidence.sufficientForWatchlist) failures.push("insufficient_evidence");
  }
  return [...new Set(failures)];
}

export interface ClassificationOutcome {
  baseSignalType: SignalType;
  finalSignalType: SignalType;
  promotionReasons: string[];
  skipReason: string | null;
  classificationMeta: Record<string, unknown>;
}

export function classifyMarketSignal(input: {
  watchlist: WatchlistInput;
  evidence: SignalEvidenceInput;
  insufficientDataForced: boolean;
  skipReason: string | null;
}): ClassificationOutcome {
  const baseSignalType = classifySignalType(input.watchlist);
  const evidence = evaluateSignalEvidence(input.evidence);
  let finalSignalType = baseSignalType;
  const promotionReasons: string[] = [];

  if (baseSignalType === "TRADE_NOW" && !evidence.sufficientForTradeNow) {
    promotionReasons.push(...evidencePromotionFailures(evidence, input.evidence));
    finalSignalType = evidence.sufficientForWatchlist ? "WATCHLIST" : "RESEARCH";
  } else if (baseSignalType === "WATCHLIST" && !evidence.sufficientForWatchlist) {
    promotionReasons.push(...evidencePromotionFailures(evidence, input.evidence));
    finalSignalType = "RESEARCH";
  }

  if (input.insufficientDataForced && finalSignalType === "TRADE_NOW") {
    promotionReasons.push("insufficient_data");
    finalSignalType = "RESEARCH";
  }

  if (baseSignalType === "TRADE_NOW" && finalSignalType !== "TRADE_NOW" && promotionReasons.length === 0) {
    promotionReasons.push(...tradeNowClassificationFailures(input.watchlist));
  }

  const uniqueReasons = [...new Set(promotionReasons)];

  return {
    baseSignalType,
    finalSignalType,
    promotionReasons: uniqueReasons,
    skipReason: input.skipReason,
    classificationMeta: {
      baseType: baseSignalType,
      finalType: finalSignalType,
      insufficientData: input.insufficientDataForced,
      evidence: {
        sufficientForWatchlist: evidence.sufficientForWatchlist,
        sufficientForTradeNow: evidence.sufficientForTradeNow,
      },
      gatesFailed: uniqueReasons,
    },
  };
}
