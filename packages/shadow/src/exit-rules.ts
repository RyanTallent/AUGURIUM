import {
  PARTIAL_EXIT_FRACTION,
  PARTIAL_EXIT_ROI,
  RUNNER_EXIT_ROI,
  RUNNER_FRACTION,
  type ExitDecision,
  type ShadowPositionState,
  type ShadowStatus,
} from "./types.js";
import { directionalRoi, pnlFromRoi } from "./math.js";

export interface ExitContext {
  currentPrice: number;
  outcomeSide: string;
  signalExpired: boolean;
  signalInactive: boolean;
  marketClosed: boolean;
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
  const roi = directionalRoi(entryPrice, currentPrice, outcomeSide);
  const unrealizedPnl = pnlFromRoi(roi, sizeUsd, positionRemaining);
  return {
    simulatedEntryPrice: entryPrice,
    currentPrice,
    simulatedSizeUsd: sizeUsd,
    positionRemaining,
    realizedPnl,
    partialExitDone: positionRemaining <= RUNNER_FRACTION + 0.001,
    runnerActive: positionRemaining > 0 && positionRemaining <= RUNNER_FRACTION + 0.001,
    roi,
    unrealizedPnl,
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 0,
  };
}

/** Augurium shadow exit: 85% at +20% ROI, 15% runner until +50% or exit triggers. */
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

  const roi = directionalRoi(
    state.simulatedEntryPrice,
    ctx.currentPrice,
    ctx.outcomeSide,
  );
  maxFavorableExcursion = Math.max(maxFavorableExcursion, roi);
  maxAdverseExcursion = Math.min(maxAdverseExcursion, roi);

  if (
    !partialExitDone &&
    positionRemaining > RUNNER_FRACTION &&
    roi >= PARTIAL_EXIT_ROI
  ) {
    realizedPnl += pnlFromRoi(roi, state.simulatedSizeUsd, PARTIAL_EXIT_FRACTION);
    positionRemaining = RUNNER_FRACTION;
    partialExitDone = true;
    runnerActive = true;
  }

  const unrealizedPnl = pnlFromRoi(roi, state.simulatedSizeUsd, positionRemaining);
  const updated: ShadowPositionState = {
    ...state,
    currentPrice: ctx.currentPrice,
    roi,
    unrealizedPnl,
    realizedPnl,
    positionRemaining,
    partialExitDone,
    runnerActive,
    maxFavorableExcursion,
    maxAdverseExcursion,
  };

  let closeReason: string | null = null;
  let status: ShadowStatus = "OPEN";

  if (ctx.marketClosed) {
    closeReason = "market closed or resolved";
    status = "CLOSED";
  } else if (ctx.signalExpired) {
    closeReason = "signal expired";
    status = "EXPIRED";
  } else if (ctx.consensusCollapsed) {
    closeReason = "consensus collapsed (signal inactive)";
    status = "CLOSED";
  } else if (runnerActive && roi >= RUNNER_EXIT_ROI) {
    closeReason = "runner target +50% ROI";
    status = "CLOSED";
  }

  if (closeReason) {
    if (positionRemaining > 0) {
      realizedPnl += pnlFromRoi(roi, state.simulatedSizeUsd, positionRemaining);
      positionRemaining = 0;
    }
    const totalRoi = safeTotalRoi(realizedPnl, state.simulatedSizeUsd);
    const missed = Math.max(0, maxFavorableExcursion - totalRoi) * state.simulatedSizeUsd;
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
        missedProfitAfterExit: missed,
        wouldHaveBeenBetterToHold: missed > state.simulatedSizeUsd * 0.05,
      },
    };
  }

  return { state: updated, decision: null };
}

function safeTotalRoi(realizedPnl: number, sizeUsd: number): number {
  if (sizeUsd <= 0) return 0;
  return realizedPnl / sizeUsd;
}
