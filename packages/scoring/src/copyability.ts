import { COPY_DELAYS, type TapePoint, type TradeInput } from "./types.js";
import { clamp, isBuySide, safeDivide } from "./math.js";

function priceAtOrAfter(tape: TapePoint[], targetMs: number): number | null {
  for (const p of tape) {
    if (p.tradedAt.getTime() >= targetMs) return p.price;
  }
  return tape.length ? tape[tape.length - 1].price : null;
}

function directionalMove(entry: number, later: number, buy: boolean): number {
  if (entry <= 0 || later <= 0) return 0;
  const raw = (later - entry) / entry;
  return buy ? raw : -raw;
}

export interface CopyabilityResult {
  copyabilityScore: number;
  estimatedCopiedRoi: number;
  averageSlippageEstimate: number;
  averageExecutionDelayEstimate: number;
  mirrorabilityScore: number;
  copiedProfitFactor: number;
}

export function computeCopyability(
  traderTrades: TradeInput[],
  marketTapes: Map<string, TapePoint[]>,
): CopyabilityResult {
  if (traderTrades.length === 0) {
    return {
      copyabilityScore: 0,
      estimatedCopiedRoi: 0,
      averageSlippageEstimate: 0,
      averageExecutionDelayEstimate: 0,
      mirrorabilityScore: 0,
      copiedProfitFactor: 0,
    };
  }

  const delayScores: number[] = [];
  const copiedReturns: number[] = [];
  const slippages: number[] = [];
  const mirrorFlags: number[] = [];

  for (const trade of traderTrades) {
    const key = `${trade.conditionId}:${trade.asset}`;
    const tape = marketTapes.get(key);
    if (!tape?.length) continue;

    const buy = isBuySide(trade.side);
    const entry = trade.price;
    const entryMs = trade.tradedAt.getTime();

    for (const delay of COPY_DELAYS) {
      const copiedPrice = priceAtOrAfter(tape, entryMs + delay.ms);
      if (copiedPrice == null) continue;

      const slip = Math.abs(copiedPrice - entry) / Math.max(entry, 0.01);
      slippages.push(slip);

      const move = directionalMove(entry, copiedPrice, buy);
      const stillGood = move >= -0.02;
      delayScores.push(stillGood ? 1 : clamp(1 + move * 5, 0, 1));

      const forwardPrice = priceAtOrAfter(tape, entryMs + delay.ms * 4);
      if (forwardPrice != null) {
        copiedReturns.push(directionalMove(copiedPrice, forwardPrice, buy));
      }
    }

    const move30s = directionalMove(entry, priceAtOrAfter(tape, entryMs + 30_000) ?? entry, buy);
    mirrorFlags.push(move30s >= 0 ? 1 : 0);
  }

  const copyabilityScore = safeDivide(
    delayScores.reduce((a, b) => a + b, 0),
    delayScores.length,
    0,
  );

  const estimatedCopiedRoi =
    copiedReturns.length > 0
      ? copiedReturns.reduce((a, b) => a + b, 0) / copiedReturns.length
      : 0;

  const wins = copiedReturns.filter((r) => r > 0);
  const losses = Math.abs(
    copiedReturns.filter((r) => r < 0).reduce((a, b) => a + b, 0),
  );
  const copiedProfitFactor = losses === 0 ? (wins.length ? 5 : 0) : clamp(wins.reduce((a, b) => a + b, 0) / losses, 0, 10);

  return {
    copyabilityScore: clamp(copyabilityScore, 0, 1),
    estimatedCopiedRoi,
    averageSlippageEstimate: safeDivide(slippages.reduce((a, b) => a + b, 0), slippages.length, 0),
    averageExecutionDelayEstimate: 180,
    mirrorabilityScore: safeDivide(mirrorFlags.reduce((a, b) => a + b, 0), mirrorFlags.length, 0),
    copiedProfitFactor,
  };
}
