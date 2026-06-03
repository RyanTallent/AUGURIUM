import { closedPositionRoi, isPlausibleEntryPrice, MIN_PLAUSIBLE_PRICE, MAX_PLAUSIBLE_PRICE } from "./roi.js";
import { PARTIAL_EXIT_FRACTION, PARTIAL_EXIT_ROI, RUNNER_FRACTION } from "./types.js";

export type PayoutFormula =
  | "mark_to_market"
  | "resolved_winner"
  | "resolved_loser"
  | "partial_mark"
  | "runner_mark";

export type ResolutionPayoutMode = "winner" | "loser" | "mark_only";

export interface PayoutLegInput {
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  outcomeSide: string;
  /** Fraction of original position (0–1) for this leg. */
  positionFraction: number;
}

export interface PayoutValidation {
  valid: boolean;
  diagnostic: string | null;
  formula: PayoutFormula | null;
  expectedRealizedPnl: number;
  expectedRoi: number;
}

/** Shares purchased with cost basis at entry. */
export function computeShares(costBasis: number, entryPrice: number): number {
  if (costBasis <= 0 || entryPrice <= 0) return 0;
  return costBasis / entryPrice;
}

function isNoSide(outcomeSide: string): boolean {
  const s = outcomeSide.toUpperCase();
  return s === "NO" || s.startsWith("AGAINST_");
}

/**
 * Mark-to-market PnL for a position leg (non-resolution).
 * YES: (exit - entry) * shares
 * NO: (entry - exit) * shares
 */
export function markToMarketPnl(input: PayoutLegInput): number {
  const { entryPrice, exitPrice, costBasis, outcomeSide, positionFraction } = input;
  if (costBasis <= 0 || entryPrice <= 0 || positionFraction <= 0) return 0;
  const shares = computeShares(costBasis, entryPrice) * positionFraction;
  if (shares <= 0) return 0;

  if (pricesEffectivelyEqual(entryPrice, exitPrice)) return 0;

  if (isNoSide(outcomeSide)) {
    return (entryPrice - exitPrice) * shares;
  }
  return (exitPrice - entryPrice) * shares;
}

/** Resolved winner: redeem shares at $1.00. */
export function resolvedWinnerPnl(
  costBasis: number,
  entryPrice: number,
  positionFraction: number,
): number {
  if (costBasis <= 0 || entryPrice <= 0 || positionFraction <= 0) return 0;
  const legCost = costBasis * positionFraction;
  const shares = computeShares(costBasis, entryPrice) * positionFraction;
  const payout = shares * 1.0;
  return payout - legCost;
}

/** Resolved loser: shares worthless. */
export function resolvedLoserPnl(costBasis: number, positionFraction: number): number {
  if (costBasis <= 0 || positionFraction <= 0) return 0;
  return -costBasis * positionFraction;
}

export function roiFromPnl(realizedPnl: number, costBasis: number): number {
  return closedPositionRoi(realizedPnl, costBasis);
}

/** Infer resolution from exit price (YES-token price). */
export function inferResolutionMode(
  exitPrice: number,
  outcomeSide: string,
): ResolutionPayoutMode {
  if (exitPrice >= 0.95) {
    return isNoSide(outcomeSide) ? "loser" : "winner";
  }
  if (exitPrice <= 0.05) {
    return isNoSide(outcomeSide) ? "winner" : "loser";
  }
  return "mark_only";
}

/** +20% partial trigger price (YES: entry*1.2, NO: entry*0.8). */
export function partialTriggerPrice(entryPrice: number, outcomeSide: string): number {
  if (isNoSide(outcomeSide)) {
    return entryPrice * (1 - PARTIAL_EXIT_ROI);
  }
  return entryPrice * (1 + PARTIAL_EXIT_ROI);
}

const PRICE_EPS = 1e-9;

/** Entry and exit are the same price within float/display tolerance. */
export function pricesEffectivelyEqual(entryPrice: number, exitPrice: number): boolean {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) return false;
  const scale = Math.max(1, Math.abs(entryPrice), Math.abs(exitPrice));
  return Math.abs(exitPrice - entryPrice) <= Math.max(PRICE_EPS, scale * 1e-6);
}

export function isImpossibleFlatPnl(
  entryPrice: number,
  exitPrice: number,
  realizedPnl: number,
): boolean {
  return pricesEffectivelyEqual(entryPrice, exitPrice) && Math.abs(realizedPnl) > 0.01;
}

export function priceHitsPartialTarget(
  entryPrice: number,
  currentPrice: number,
  outcomeSide: string,
): boolean {
  if (entryPrice <= 0 || currentPrice <= 0) return false;
  if (isNoSide(outcomeSide)) {
    return currentPrice <= partialTriggerPrice(entryPrice, outcomeSide) + PRICE_EPS;
  }
  return currentPrice >= partialTriggerPrice(entryPrice, outcomeSide) - PRICE_EPS;
}

/** +50% runner trigger price (YES: entry*1.5, NO: entry*0.5). */
export function runnerTargetPrice(entryPrice: number, outcomeSide: string): number {
  if (isNoSide(outcomeSide)) {
    return entryPrice * (1 - 0.5);
  }
  return entryPrice * (1 + 0.5);
}

export function priceHitsRunnerTarget(
  entryPrice: number,
  currentPrice: number,
  outcomeSide: string,
): boolean {
  if (entryPrice <= 0 || currentPrice <= 0) return false;
  if (isNoSide(outcomeSide)) {
    return currentPrice <= runnerTargetPrice(entryPrice, outcomeSide) + PRICE_EPS;
  }
  return currentPrice >= runnerTargetPrice(entryPrice, outcomeSide) - PRICE_EPS;
}

/** Max ROI for mark-to-market before resolution. */
export function maxMarkToMarketRoi(entryPrice: number, outcomeSide: string): number {
  if (entryPrice <= 0) return 0;
  if (isNoSide(outcomeSide)) {
    return markToMarketPnl({
      entryPrice,
      exitPrice: MIN_PLAUSIBLE_PRICE,
      costBasis: 1,
      outcomeSide,
      positionFraction: 1,
    });
  }
  return (MAX_PLAUSIBLE_PRICE - entryPrice) / entryPrice;
}

/** Max ROI when resolved winner (YES). */
export function maxResolvedWinnerRoi(entryPrice: number): number {
  if (entryPrice <= 0) return 0;
  return (1.0 - entryPrice) / entryPrice;
}

export function maxPossibleRoi(
  entryPrice: number,
  outcomeSide: string,
  useResolution: boolean,
): number {
  if (useResolution) {
    return Math.max(maxResolvedWinnerRoi(entryPrice), 1);
  }
  return maxMarkToMarketRoi(entryPrice, outcomeSide);
}

export function pnlForCloseLeg(
  formula: PayoutFormula,
  input: PayoutLegInput,
): number {
  switch (formula) {
    case "resolved_winner":
      return resolvedWinnerPnl(input.costBasis, input.entryPrice, input.positionFraction);
    case "resolved_loser":
      return resolvedLoserPnl(input.costBasis, input.positionFraction);
    case "mark_to_market":
    case "partial_mark":
    case "runner_mark":
    default:
      return markToMarketPnl(input);
  }
}

export function selectCloseFormula(
  closeReason: string,
  marketResolved: boolean,
  exitPrice: number,
  outcomeSide: string,
): PayoutFormula {
  const resolution = inferResolutionMode(exitPrice, outcomeSide);
  const resolvedClose =
    marketResolved &&
    (closeReason.includes("resolved") || closeReason.includes("market closed")) &&
    resolution !== "mark_only";

  if (resolvedClose && resolution === "winner") return "resolved_winner";
  if (resolvedClose && resolution === "loser") return "resolved_loser";

  if (closeReason.includes("runner")) return "runner_mark";
  if (closeReason.includes("partial") || closeReason.includes("+20%")) return "partial_mark";
  return "mark_to_market";
}

export function validateClosedPayout(input: {
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  realizedPnl: number;
  outcomeSide: string;
  formula: PayoutFormula | null;
  partialExitDone: boolean;
  positionRemainingAtClose: number;
  priorRealizedPnl: number;
}): PayoutValidation {
  const { entryPrice, exitPrice, costBasis, realizedPnl, outcomeSide } = input;

  if (costBasis <= 0) {
    return {
      valid: false,
      diagnostic: "missing_cost_basis",
      formula: null,
      expectedRealizedPnl: 0,
      expectedRoi: 0,
    };
  }
  if (!isPlausibleEntryPrice(entryPrice)) {
    return {
      valid: false,
      diagnostic: "missing_entry_price",
      formula: null,
      expectedRealizedPnl: 0,
      expectedRoi: 0,
    };
  }

  const flat = pricesEffectivelyEqual(entryPrice, exitPrice);
  const formula = input.formula ?? "mark_to_market";

  let expected = input.priorRealizedPnl;
  const rem = input.positionRemainingAtClose;
  if (rem > 0) {
    expected += pnlForCloseLeg(formula, {
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide,
      positionFraction: rem,
    });
  } else if (!input.partialExitDone) {
    expected = pnlForCloseLeg(formula, {
      entryPrice,
      exitPrice,
      costBasis,
      outcomeSide,
      positionFraction: 1,
    });
  }

  if (flat && Math.abs(realizedPnl) > 0.01) {
    return {
      valid: false,
      diagnostic: "entry_equals_exit_nonzero_pnl",
      formula,
      expectedRealizedPnl: 0,
      expectedRoi: 0,
    };
  }

  const expectedRoi = roiFromPnl(expected, costBasis);
  const maxRoi = maxPossibleRoi(
    entryPrice,
    outcomeSide,
    formula === "resolved_winner" || formula === "resolved_loser",
  );

  if (expectedRoi > maxRoi + 0.05) {
    return {
      valid: false,
      diagnostic: "roi_exceeds_bounds",
      formula,
      expectedRealizedPnl: expected,
      expectedRoi,
    };
  }
  if (expectedRoi > 10) {
    return {
      valid: false,
      diagnostic: "roi_gt_1000pct",
      formula,
      expectedRealizedPnl: expected,
      expectedRoi,
    };
  }
  if (expectedRoi < -1.01) {
    return {
      valid: false,
      diagnostic: "roi_below_minus_100pct",
      formula,
      expectedRealizedPnl: expected,
      expectedRoi,
    };
  }

  const tolerance = Math.max(0.5, costBasis * 0.02);
  if (Math.abs(realizedPnl - expected) > tolerance) {
    return {
      valid: false,
      diagnostic: "pnl_formula_mismatch",
      formula,
      expectedRealizedPnl: expected,
      expectedRoi,
    };
  }

  return {
    valid: true,
    diagnostic: null,
    formula,
    expectedRealizedPnl: expected,
    expectedRoi: roiFromPnl(realizedPnl, costBasis),
  };
}

export type InvalidAnalyticsReason =
  | "entry_equals_exit_nonzero_pnl"
  | "roi_gt_1000pct"
  | "roi_below_minus_100pct"
  | "missing_entry_price"
  | "missing_cost_basis"
  | "pnl_formula_mismatch"
  | "roi_exceeds_bounds"
  | "duplicate_close"
  | "unreconcilable";

export function classifyInvalidForAnalytics(
  validation: PayoutValidation,
  extra?: { duplicateClose?: boolean; unreconcilable?: boolean },
): { invalid: boolean; reason: InvalidAnalyticsReason | null } {
  if (extra?.duplicateClose) {
    return { invalid: true, reason: "duplicate_close" };
  }
  if (extra?.unreconcilable) {
    return { invalid: true, reason: "unreconcilable" };
  }
  if (!validation.valid && validation.diagnostic) {
    return {
      invalid: true,
      reason: validation.diagnostic as InvalidAnalyticsReason,
    };
  }
  return { invalid: false, reason: null };
}
