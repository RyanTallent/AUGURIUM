import {
  PARTIAL_EXIT_FRACTION,
  RUNNER_FRACTION,
  type ExitDecision,
  type ShadowPositionState,
  type ShadowStatus,
} from "./types.js";
import {
  inferResolutionMode,
  markToMarketPnl,
  priceHitsPartialTarget,
  priceHitsRunnerTarget,
  pnlForCloseLeg,
  roiFromPnl,
  selectCloseFormula,
  type PayoutFormula,
} from "./payout.js";
import { closedPositionRoi } from "./roi.js";

export interface ExitContext {
  currentPrice: number;
  outcomeSide: string;
  signalExpired: boolean;
  signalInactive: boolean;
  marketClosed: boolean;
  marketResolved: boolean;
  consensusCollapsed: boolean;
}

export function updateExcursions(
  state: ShadowPositionState,
  roi: number,
): ShadowPositionState {
  return {
    ...state,
    maxFavorableExcursion: Math.max(state.maxFavorableExcursion, roi),
    maxAdverseExcursion: Math.min(state.maxAdverseExcursion, roi),
  };
}

export function computePositionMetrics(
  entryPrice: number,
  currentPrice: number,
  sizeUsd: number,
  positionRemaining: number,
  realizedPnl: number,
  outcomeSide: string,
): ShadowPositionState {
  const legFraction = Math.max(0, Math.min(1, positionRemaining));
  const unrealizedPnl = markToMarketPnl({
    entryPrice,
    exitPrice: currentPrice,
    costBasis: sizeUsd,
    outcomeSide,
    positionFraction: legFraction,
  });
  const legBasis = sizeUsd * legFraction;
  const roi = legBasis > 0 ? unrealizedPnl / legBasis : 0;
  const totalBasis = sizeUsd;
  const markRoi = roiFromPnl(realizedPnl + unrealizedPnl, totalBasis);

  return {
    simulatedEntryPrice: entryPrice,
    currentPrice,
    simulatedSizeUsd: sizeUsd,
    positionRemaining,
    realizedPnl,
    partialExitDone: positionRemaining <= RUNNER_FRACTION + 0.001,
    runnerActive: positionRemaining > 0 && positionRemaining <= RUNNER_FRACTION + 0.001,
    roi: markRoi,
    unrealizedPnl,
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 0,
  };
}

function directionalRoiForExcursion(
  entryPrice: number,
  currentPrice: number,
  outcomeSide: string,
): number {
  if (entryPrice <= 0) return 0;
  const pnl = markToMarketPnl({
    entryPrice,
    exitPrice: currentPrice,
    costBasis: 1,
    outcomeSide,
    positionFraction: 1,
  });
  return pnl;
}

/** Augurium shadow exit: share-based PnL; runner/partial use price targets. */
export function applyAuguriumExitRules(
  state: ShadowPositionState,
  ctx: ExitContext,
  entryReasoning: string,
): { state: ShadowPositionState; decision: ExitDecision | null } {
  let {
    positionRemaining,
    realizedPnl,
    partialExitDone,
    runnerActive,
    maxFavorableExcursion,
    maxAdverseExcursion,
  } = state;

  const entry = state.simulatedEntryPrice;
  const exit = ctx.currentPrice;
  const basis = state.simulatedSizeUsd;
  const side = ctx.outcomeSide;

  const excursionRoi = directionalRoiForExcursion(entry, exit, side);
  maxFavorableExcursion = Math.max(maxFavorableExcursion, excursionRoi);
  maxAdverseExcursion = Math.min(maxAdverseExcursion, excursionRoi);

  if (
    !partialExitDone &&
    positionRemaining > RUNNER_FRACTION + 0.001 &&
    priceHitsPartialTarget(entry, exit, side)
  ) {
    const partialPnl = markToMarketPnl({
      entryPrice: entry,
      exitPrice: exit,
      costBasis: basis,
      outcomeSide: side,
      positionFraction: PARTIAL_EXIT_FRACTION,
    });
    realizedPnl += partialPnl;
    positionRemaining = RUNNER_FRACTION;
    partialExitDone = true;
    runnerActive = true;
  }

  const unrealizedPnl = markToMarketPnl({
    entryPrice: entry,
    exitPrice: exit,
    costBasis: basis,
    outcomeSide: side,
    positionFraction: positionRemaining,
  });

  const updated: ShadowPositionState = {
    ...state,
    currentPrice: exit,
    unrealizedPnl,
    realizedPnl,
    positionRemaining,
    partialExitDone,
    runnerActive,
    maxFavorableExcursion,
    maxAdverseExcursion,
    roi: roiFromPnl(realizedPnl + unrealizedPnl, basis),
  };

  let closeReason: string | null = null;
  let status: ShadowStatus = "OPEN";
  let formula: PayoutFormula = "mark_to_market";

  const resolution = inferResolutionMode(exit, side);
  const resolvedMarket = ctx.marketResolved && ctx.marketClosed;

  if (resolvedMarket && resolution !== "mark_only") {
    closeReason = "market resolved";
    status = "CLOSED";
    formula = resolution === "winner" ? "resolved_winner" : "resolved_loser";
  } else if (ctx.marketClosed && !ctx.marketResolved) {
    closeReason = "market closed";
    status = "CLOSED";
    formula = "mark_to_market";
  } else if (ctx.signalExpired) {
    closeReason = "signal expired";
    status = "EXPIRED";
    formula = "mark_to_market";
  } else if (ctx.consensusCollapsed) {
    closeReason = "consensus collapsed (signal inactive)";
    status = "CLOSED";
    formula = "mark_to_market";
  } else if (runnerActive && priceHitsRunnerTarget(entry, exit, side)) {
    closeReason = "runner target +50% price";
    status = "CLOSED";
    formula = "runner_mark";
  }

  if (closeReason) {
    if (positionRemaining > 0) {
      const legFormula = selectCloseFormula(closeReason, resolvedMarket, exit, side);
      const closePnl = pnlForCloseLeg(legFormula, {
        entryPrice: entry,
        exitPrice: exit,
        costBasis: basis,
        outcomeSide: side,
        positionFraction: positionRemaining,
      });
      realizedPnl += closePnl;
      positionRemaining = 0;
      formula = legFormula;
    }

    const totalRoi = closedPositionRoi(realizedPnl, basis);
    const missed = Math.max(0, maxFavorableExcursion * basis - realizedPnl);

    return {
      state: {
        ...updated,
        positionRemaining: 0,
        realizedPnl,
        unrealizedPnl: 0,
        roi: totalRoi,
        runnerActive: false,
      },
      decision: {
        status,
        closeReason,
        latestReasoning: `${entryReasoning} | Closed: ${closeReason}.`,
        realizedPnl,
        positionRemaining: 0,
        partialExitDone,
        runnerActive: false,
        missedProfitAfterExit: Math.max(0, missed),
        wouldHaveBeenBetterToHold: missed > basis * 0.05,
        payoutFormula: formula,
      },
    };
  }

  return { state: updated, decision: null };
}
