import type { TapePoint, TradeInput } from "./types.js";
import { clamp, isBuySide } from "./math.js";

const HORIZONS_MS = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  24 * 60 * 60_000,
];

function priceAtOrAfter(tape: TapePoint[], targetMs: number): number | null {
  for (const p of tape) {
    if (p.tradedAt.getTime() >= targetMs) return p.price;
  }
  return null;
}

export function computeInformationEdgeScore(
  traderTrades: TradeInput[],
  marketTapes: Map<string, TapePoint[]>,
): number {
  const edges: number[] = [];

  for (const trade of traderTrades) {
    const key = `${trade.conditionId}:${trade.asset}`;
    const tape = marketTapes.get(key);
    if (!tape?.length) continue;

    const buy = isBuySide(trade.side);
    const entry = trade.price;
    const entryMs = trade.tradedAt.getTime();

    for (const horizon of HORIZONS_MS) {
      const later = priceAtOrAfter(tape, entryMs + horizon);
      if (later == null || entry <= 0) continue;
      const raw = (later - entry) / entry;
      const directed = buy ? raw : -raw;
      edges.push(clamp(directed * 10, -1, 1));
    }
  }

  if (edges.length === 0) return 0;
  const avg = edges.reduce((a, b) => a + b, 0) / edges.length;
  return clamp((avg + 1) / 2, 0, 1);
}
