import { directionalRoi, priceAtOrAfter } from "./math.js";
import type { SimulationInput, SimulationOutput, TapePoint } from "./types.js";
import {
  DEFAULT_SIZE_USD,
  PARTIAL_EXIT_FRACTION,
  PARTIAL_EXIT_ROI,
  RUNNER_EXIT_ROI,
  RUNNER_FRACTION,
} from "./types.js";

export const SIMULATION_STRATEGIES = [
  "augurium_rules",
  "hold_until_signal_expiry",
  "hold_until_market_close",
  "exit_at_10pct",
  "exit_at_20pct",
  "exit_at_30pct",
  "no_partial_full_exit_20",
  "entry_delay_30s",
  "entry_delay_10m",
] as const;

export type SimulationStrategyName = (typeof SIMULATION_STRATEGIES)[number];

function buildPricePath(
  tape: TapePoint[],
  startMs: number,
  endMs: number,
): TapePoint[] {
  return tape.filter(
    (p) => p.tradedAt.getTime() >= startMs && p.tradedAt.getTime() <= endMs,
  );
}

function simulatePath(
  input: SimulationInput,
  strategy: SimulationStrategyName,
): SimulationOutput {
  const signalMs = input.signalCreatedAt.getTime();
  const delay =
    strategy === "entry_delay_30s"
      ? 30_000
      : strategy === "entry_delay_10m"
        ? 600_000
        : input.entryDelayMs;

  const entryMs = signalMs + delay;
  const entryPrice =
    priceAtOrAfter(input.priceSeries, entryMs) ?? input.entryPrice;
  const expireMs = input.signalExpiresAt?.getTime() ?? entryMs + 6 * 3600_000;
  const endMs = input.marketClosed
    ? Date.now()
    : strategy === "hold_until_market_close"
      ? Date.now()
      : strategy === "hold_until_signal_expiry"
        ? expireMs
        : Date.now();

  const path = buildPricePath(input.priceSeries, entryMs, endMs);
  if (!path.length) {
    return emptyResult(input, strategy, entryPrice, entryPrice, 0);
  }

  let position = 1;
  let realized = 0;
  let peakEquity = input.simulatedSizeUsd;
  let troughEquity = input.simulatedSizeUsd;
  let exitPrice = entryPrice;
  let exitMs = entryMs;

  const exitThreshold =
    strategy === "exit_at_10pct"
      ? 0.1
      : strategy === "exit_at_20pct" || strategy === "no_partial_full_exit_20"
        ? 0.2
        : strategy === "exit_at_30pct"
          ? 0.3
          : null;

  for (const point of path) {
    exitPrice = point.price;
    exitMs = point.tradedAt.getTime();
    const roi = directionalRoi(entryPrice, point.price, input.side);

    if (strategy === "augurium_rules") {
      if (position > RUNNER_FRACTION && roi >= PARTIAL_EXIT_ROI) {
        realized += input.simulatedSizeUsd * PARTIAL_EXIT_FRACTION * roi;
        position = RUNNER_FRACTION;
      }
      if (position > 0 && position <= RUNNER_FRACTION && roi >= RUNNER_EXIT_ROI) {
        realized += input.simulatedSizeUsd * position * roi;
        position = 0;
        break;
      }
    } else if (exitThreshold != null && strategy === "no_partial_full_exit_20") {
      if (roi >= exitThreshold) {
        realized = input.simulatedSizeUsd * roi;
        position = 0;
        break;
      }
    } else if (exitThreshold != null && roi >= exitThreshold) {
      realized = input.simulatedSizeUsd * roi;
      position = 0;
      break;
    }

    const equity = input.simulatedSizeUsd + realized + input.simulatedSizeUsd * position * roi;
    peakEquity = Math.max(peakEquity, equity);
    troughEquity = Math.min(troughEquity, equity);

    if (point.tradedAt.getTime() >= expireMs && strategy === "hold_until_signal_expiry") {
      if (position > 0) {
        realized += input.simulatedSizeUsd * position * roi;
        position = 0;
      }
      break;
    }
  }

  if (position > 0) {
    const finalRoi = directionalRoi(entryPrice, exitPrice, input.side);
    realized += input.simulatedSizeUsd * position * finalRoi;
  }

  const totalRoi = realized / input.simulatedSizeUsd;
  const maxDrawdown =
    peakEquity > 0 ? Math.max(0, (peakEquity - troughEquity) / peakEquity) : 0;

  return {
    strategyName: strategy,
    entryDelayMs: delay,
    entryPrice,
    exitPrice,
    roi: totalRoi,
    maxDrawdown,
    holdingTimeMs: Math.max(0, exitMs - entryMs),
    outcome: totalRoi > 0.02 ? "WIN" : totalRoi < -0.02 ? "LOSS" : "FLAT",
  };
}

function emptyResult(
  input: SimulationInput,
  strategy: string,
  entry: number,
  exit: number,
  holding: number,
): SimulationOutput {
  return {
    strategyName: strategy,
    entryDelayMs: input.entryDelayMs,
    entryPrice: entry,
    exitPrice: exit,
    roi: 0,
    maxDrawdown: 0,
    holdingTimeMs: holding,
    outcome: "FLAT",
  };
}

export function runAllSimulations(input: SimulationInput): SimulationOutput[] {
  return SIMULATION_STRATEGIES.map((s) => simulatePath(input, s));
}

export function shadowTradeKey(signalId: string): string {
  return signalId;
}
