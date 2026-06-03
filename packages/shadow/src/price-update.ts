import { priceAtOrAfter } from "./math.js";
import type { TapePoint } from "./types.js";

export type PriceStatus = "FRESH" | "STALE" | "NO_PRICE_UPDATE" | "NO_PRICE_SOURCE";
export type PriceSource = "TRADE_TAPE" | "MARKET_SNAPSHOT" | "LAST_KNOWN" | "ENTRY_FALLBACK";

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;

export interface ResolveShadowPriceInput {
  entryMs: number;
  entryPrice: number;
  side: string;
  tape: TapePoint[];
  marketSnapshotPrice?: number | null;
  lastKnownPrice?: number | null;
  marketLatestTrade?: { tradedAt: Date; price: number } | null;
  now?: Date;
  staleAfterMs?: number;
}

export interface ResolveShadowPriceResult {
  currentPrice: number;
  priceStatus: PriceStatus;
  priceSource: PriceSource;
  lastPriceUpdateAt: Date | null;
}

function latestPostEntry(tape: TapePoint[], entryMs: number): TapePoint | null {
  let latest: TapePoint | null = null;
  for (const p of tape) {
    if (p.tradedAt.getTime() >= entryMs) latest = p;
  }
  return latest;
}

function latestOnTape(tape: TapePoint[]): TapePoint | null {
  if (tape.length === 0) return null;
  return tape[tape.length - 1]!;
}

function freshTapeResult(
  point: TapePoint,
  now: Date,
  staleAfterMs: number,
): ResolveShadowPriceResult {
  const ageMs = now.getTime() - point.tradedAt.getTime();
  return {
    currentPrice: point.price,
    priceStatus: ageMs <= staleAfterMs ? "FRESH" : "STALE",
    priceSource: "TRADE_TAPE",
    lastPriceUpdateAt: point.tradedAt,
  };
}

export function resolveShadowPrice(input: ResolveShadowPriceInput): ResolveShadowPriceResult {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_MS;
  const entryMs = input.entryMs;

  const postEntry = latestPostEntry(input.tape, entryMs);
  if (postEntry && postEntry.price > 0) {
    return freshTapeResult(postEntry, now, staleAfterMs);
  }

  const latest = latestOnTape(input.tape);
  if (latest && latest.price > 0) {
    return freshTapeResult(latest, now, staleAfterMs);
  }

  if (input.marketLatestTrade && input.marketLatestTrade.price > 0) {
    return freshTapeResult(input.marketLatestTrade, now, staleAfterMs);
  }

  if (input.marketSnapshotPrice != null && input.marketSnapshotPrice > 0) {
    return {
      currentPrice: input.marketSnapshotPrice,
      priceStatus: "STALE",
      priceSource: "MARKET_SNAPSHOT",
      lastPriceUpdateAt: now,
    };
  }

  if (input.lastKnownPrice != null && input.lastKnownPrice > 0) {
    const changed = Math.abs(input.lastKnownPrice - input.entryPrice) > 1e-6;
    return {
      currentPrice: input.lastKnownPrice,
      priceStatus: changed ? "STALE" : "NO_PRICE_UPDATE",
      priceSource: "LAST_KNOWN",
      lastPriceUpdateAt: null,
    };
  }

  const atOrAfter = priceAtOrAfter(input.tape, entryMs);
  if (atOrAfter != null && atOrAfter > 0) {
    return {
      currentPrice: atOrAfter,
      priceStatus: "NO_PRICE_UPDATE",
      priceSource: "TRADE_TAPE",
      lastPriceUpdateAt: null,
    };
  }

  if (input.entryPrice > 0) {
    return {
      currentPrice: input.entryPrice,
      priceStatus: "NO_PRICE_SOURCE",
      priceSource: "ENTRY_FALLBACK",
      lastPriceUpdateAt: null,
    };
  }

  return {
    currentPrice: 0.5,
    priceStatus: "NO_PRICE_SOURCE",
    priceSource: "ENTRY_FALLBACK",
    lastPriceUpdateAt: null,
  };
}
