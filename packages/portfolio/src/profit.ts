import {
  applyAuguriumExitRules,
  computePositionMetrics,
  type ExitContext,
} from "@augurium/shadow";
import type { PortfolioConfig } from "./config.js";
import { splitProfits } from "./capital.js";

export interface SimulatedPositionUpdate {
  currentPrice: number;
  positionRemaining: number;
  partialExitDone: boolean;
  runnerActive: boolean;
  unrealizedPnl: number;
  realizedPnl: number;
  roi: number;
  missedProfit: number;
  status: string;
  closed: boolean;
  closeReason: string | null;
  profitSplit: { reinvestUsd: number; reserveUsd: number } | null;
}

export function updateSimulatedPosition(
  entryPrice: number,
  currentPrice: number,
  allocatedUsd: number,
  positionRemaining: number,
  realizedPnl: number,
  partialExitDone: boolean,
  runnerActive: boolean,
  side: string,
  ctx: ExitContext,
  config: PortfolioConfig,
): SimulatedPositionUpdate {
  const metrics = computePositionMetrics(
    entryPrice,
    currentPrice,
    allocatedUsd,
    positionRemaining,
    realizedPnl,
    side,
  );

  const { state, decision } = applyAuguriumExitRules(
    {
      ...metrics,
      partialExitDone,
      runnerActive,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
    },
    ctx,
    "simulated portfolio position",
  );

  const closed = decision !== null;
  let profitSplit: { reinvestUsd: number; reserveUsd: number } | null = null;
  if (closed && state.realizedPnl > 0) {
    profitSplit = splitProfits(state.realizedPnl, config);
  }

  return {
    currentPrice,
    positionRemaining: state.positionRemaining,
    partialExitDone: state.partialExitDone,
    runnerActive: state.runnerActive,
    unrealizedPnl: state.unrealizedPnl,
    realizedPnl: state.realizedPnl,
    roi: state.roi,
    missedProfit: decision?.missedProfitAfterExit ?? 0,
    status: closed ? (decision?.status ?? "CLOSED") : "OPEN",
    closed,
    closeReason: decision?.closeReason ?? null,
    profitSplit,
  };
}

/** Advisory-only — no execution API. */
export const EXECUTION_DISABLED = true;
