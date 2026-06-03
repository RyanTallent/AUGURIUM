import type { SideConsensusResult } from "./types.js";
import type { SignalType } from "./types.js";

export interface SignalEvidenceInput {
  consensus: SideConsensusResult;
  marketQualityScore: number;
  systemConfidenceScore: number;
  hasSuperElite: boolean;
}

export interface SignalEvidenceResult {
  sufficientForWatchlist: boolean;
  sufficientForTradeNow: boolean;
  downgradeReason: string | null;
}

const MIN_WATCHLIST_TRADERS = 3;
const MIN_WATCHLIST_NOTIONAL = 500;
const MIN_TRADE_NOW_TRADERS = 3;
const MIN_TRADE_NOW_NOTIONAL = 1000;

export function evaluateSignalEvidence(input: SignalEvidenceInput): SignalEvidenceResult {
  const traders = input.consensus.triggerTraderWallets.length;
  const notional = input.consensus.combinedNotional ?? 0;

  let downgradeReason: string | null = null;

  const superEliteBypass = input.hasSuperElite && traders >= 1 && notional >= 300;

  const sufficientForWatchlist =
    superEliteBypass ||
    (traders >= MIN_WATCHLIST_TRADERS &&
      notional >= MIN_WATCHLIST_NOTIONAL &&
      input.marketQualityScore >= 40);

  const sufficientForTradeNow =
    superEliteBypass ||
    (traders >= MIN_TRADE_NOW_TRADERS &&
      notional >= MIN_TRADE_NOW_NOTIONAL &&
      input.marketQualityScore >= 55 &&
      input.systemConfidenceScore >= 50);

  if (!sufficientForWatchlist) {
    downgradeReason = `Needs ≥${MIN_WATCHLIST_TRADERS} scored traders and $${MIN_WATCHLIST_NOTIONAL}+ notional (have ${traders} traders, $${notional.toFixed(0)})`;
  } else if (!sufficientForTradeNow) {
    downgradeReason = `TRADE_NOW gates: need ≥${MIN_TRADE_NOW_TRADERS} traders, $${MIN_TRADE_NOW_NOTIONAL}+ notional, quality≥55, system≥50`;
  }

  return { sufficientForWatchlist, sufficientForTradeNow, downgradeReason };
}

export function applyEvidenceToSignalType(
  baseType: SignalType,
  evidence: SignalEvidenceResult,
): SignalType {
  if (baseType === "IGNORE") return "IGNORE";
  if (baseType === "TRADE_NOW") {
    return evidence.sufficientForTradeNow ? "TRADE_NOW" : evidence.sufficientForWatchlist ? "WATCHLIST" : "RESEARCH";
  }
  if (baseType === "WATCHLIST") {
    return evidence.sufficientForWatchlist ? "WATCHLIST" : "RESEARCH";
  }
  return baseType;
}
