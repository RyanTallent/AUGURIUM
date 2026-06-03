import type { RealizedRoundTrip, TradeInput } from "./types.js";
import { clamp, isBuySide, safeDivide } from "./math.js";

interface Ledger {
  size: number;
  avgPrice: number;
  costBasis: number;
}

/** FIFO-style realized PnL from sequential trades per market leg. */
export function computeRealizedRoundTrips(trades: TradeInput[]): RealizedRoundTrip[] {
  const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const ledgers = new Map<string, Ledger>();
  const trips: RealizedRoundTrip[] = [];

  for (const t of sorted) {
    const key = `${t.conditionId}:${t.asset}`;
    const ledger = ledgers.get(key) ?? { size: 0, avgPrice: 0, costBasis: 0 };
    const signed = isBuySide(t.side) ? t.size : -t.size;
    const notional = t.size * t.price;

    if (ledger.size === 0 || Math.sign(ledger.size) === Math.sign(signed)) {
      const newSize = ledger.size + signed;
      const newCost = ledger.costBasis + (isBuySide(t.side) ? notional : -notional);
      ledger.size = newSize;
      ledger.avgPrice = safeDivide(Math.abs(newCost), Math.abs(newSize), t.price);
      ledger.costBasis = newCost;
      ledgers.set(key, ledger);
      continue;
    }

    const closing = Math.min(Math.abs(ledger.size), Math.abs(signed));
    const exitNotional = closing * t.price;
    const entryNotional = closing * ledger.avgPrice;
    const pnl = ledger.size > 0 ? exitNotional - entryNotional : entryNotional - exitNotional;

    trips.push({
      pnl,
      notional: entryNotional,
      won: pnl > 0,
      closedAt: t.tradedAt,
      category: t.category,
    });

    const remainingPosition = ledger.size + signed;
    ledger.size = remainingPosition;
    if (Math.abs(remainingPosition) < 1e-9) {
      ledger.avgPrice = 0;
      ledger.costBasis = 0;
    } else {
      ledger.avgPrice = t.price;
      ledger.costBasis = remainingPosition * t.price;
    }
    ledgers.set(key, ledger);
  }

  return trips;
}

export function winRateFromTrips(trips: RealizedRoundTrip[]): number {
  if (trips.length === 0) return 0;
  return trips.filter((t) => t.won).length / trips.length;
}

export function profitFactorFromTrips(trips: RealizedRoundTrip[]): number {
  const wins = trips.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const losses = Math.abs(trips.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  if (losses === 0) return wins > 0 ? 10 : 0;
  return clamp(wins / losses, 0, 10);
}

export function maxDrawdownFromTrips(trips: RealizedRoundTrip[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trips) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}
