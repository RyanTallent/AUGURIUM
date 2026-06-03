import {
  applyAuguriumExitRules,
  computePositionMetrics,
  PARTIAL_EXIT_FRACTION,
  type ExitContext,
} from "@augurium/shadow";

export interface ExecutionExitState {
  entryPrice: number;
  currentPrice: number;
  sizeUsd: number;
  positionRemaining: number;
  realizedPnl: number;
  partialExitDone: boolean;
  runnerActive: boolean;
  side: string;
}

export interface ExecutionExitResult {
  shouldClose: boolean;
  closeFraction: number;
  partialExit: boolean;
  state: ExecutionExitState;
  reason: string | null;
}

export function evaluateExecutionExit(
  state: ExecutionExitState,
  ctx: ExitContext,
): ExecutionExitResult {
  const metrics = computePositionMetrics(
    state.entryPrice,
    state.currentPrice,
    state.sizeUsd,
    state.positionRemaining,
    state.realizedPnl,
    state.side,
  );

  const { state: next, decision } = applyAuguriumExitRules(
    {
      ...metrics,
      partialExitDone: state.partialExitDone,
      runnerActive: state.runnerActive,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
    },
    ctx,
    "execution exit rules",
  );

  if (!state.partialExitDone && next.partialExitDone && next.positionRemaining > 0) {
    return {
      shouldClose: true,
      closeFraction: PARTIAL_EXIT_FRACTION,
      partialExit: true,
      state: {
        entryPrice: state.entryPrice,
        currentPrice: next.currentPrice,
        sizeUsd: state.sizeUsd,
        positionRemaining: next.positionRemaining,
        realizedPnl: next.realizedPnl,
        partialExitDone: next.partialExitDone,
        runnerActive: next.runnerActive,
        side: state.side,
      },
      reason: "partial exit at +20% ROI (85%)",
    };
  }

  if (decision) {
    return {
      shouldClose: true,
      closeFraction: next.positionRemaining,
      partialExit: false,
      state: {
        entryPrice: state.entryPrice,
        currentPrice: next.currentPrice,
        sizeUsd: state.sizeUsd,
        positionRemaining: 0,
        realizedPnl: next.realizedPnl,
        partialExitDone: next.partialExitDone,
        runnerActive: false,
        side: state.side,
      },
      reason: decision.closeReason,
    };
  }

  return {
    shouldClose: false,
    closeFraction: 0,
    partialExit: false,
    state: {
      entryPrice: state.entryPrice,
      currentPrice: next.currentPrice,
      sizeUsd: state.sizeUsd,
      positionRemaining: next.positionRemaining,
      realizedPnl: next.realizedPnl,
      partialExitDone: next.partialExitDone,
      runnerActive: next.runnerActive,
      side: state.side,
    },
    reason: null,
  };
}
