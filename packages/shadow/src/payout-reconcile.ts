import {
  isImpossibleFlatPnl,
  markToMarketPnl,
  pnlForCloseLeg,
  roiFromPnl,
  selectCloseFormula,
  validateClosedPayout,
  type PayoutFormula,
} from "./payout.js";
import { PARTIAL_EXIT_FRACTION } from "./types.js";

export interface RecomputeClosedPayoutInput {
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  outcomeSide: string;
  partialExitDone: boolean;
  closeReason: string;
  marketResolved: boolean;
  storedRealizedPnl: number;
}

export interface RecomputeClosedPayoutResult {
  realizedPnl: number;
  roi: number;
  formula: PayoutFormula;
  reconcilable: boolean;
  diagnostic: string | null;
  invalidForAnalytics: boolean;
}

export function parseCloseReasonFromReasoning(latestReasoning: string, status: string): string {
  const m = latestReasoning.match(/Closed:\s*([^.|]+)/i);
  if (m) return m[1]!.trim();
  if (status === "EXPIRED") return "signal expired";
  return "unknown";
}

/** Recompute closed shadow PnL from entry/exit and close reason (no fabricated prices). */
export function recomputeClosedPayout(
  input: RecomputeClosedPayoutInput,
): RecomputeClosedPayoutResult {
  const { entryPrice, exitPrice, costBasis, outcomeSide, partialExitDone, closeReason, marketResolved } =
    input;

  if (entryPrice <= 0 || costBasis <= 0) {
    return {
      realizedPnl: 0,
      roi: 0,
      formula: "mark_to_market",
      reconcilable: false,
      diagnostic: "missing_entry_or_basis",
      invalidForAnalytics: true,
    };
  }

  const formula = selectCloseFormula(closeReason, marketResolved, exitPrice, outcomeSide);
  let realizedPnl = 0;

  if (partialExitDone) {
    realizedPnl += markToMarketPnl({
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide,
      positionFraction: PARTIAL_EXIT_FRACTION,
    });
    realizedPnl += pnlForCloseLeg(formula, {
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide,
      positionFraction: 1 - PARTIAL_EXIT_FRACTION,
    });
  } else {
    realizedPnl = pnlForCloseLeg(formula, {
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide,
      positionFraction: 1,
    });
  }

  if (isImpossibleFlatPnl(entryPrice, exitPrice, input.storedRealizedPnl)) {
    return {
      realizedPnl: 0,
      roi: 0,
      formula: "mark_to_market",
      reconcilable: true,
      diagnostic: "entry_equals_exit_corrected",
      invalidForAnalytics: false,
    };
  }

  const check = validateClosedPayout({
    entryPrice,
    exitPrice,
    costBasis,
    realizedPnl,
    outcomeSide,
    formula,
    partialExitDone,
    positionRemainingAtClose: 0,
    priorRealizedPnl: 0,
  });

  if (!check.valid) {
    return {
      realizedPnl,
      roi: roiFromPnl(realizedPnl, costBasis),
      formula,
      reconcilable: check.diagnostic !== "missing_entry_price",
      diagnostic: check.diagnostic,
      invalidForAnalytics: true,
    };
  }

  return {
    realizedPnl,
    roi: roiFromPnl(realizedPnl, costBasis),
    formula,
    reconcilable: true,
    diagnostic: null,
    invalidForAnalytics: false,
  };
}
