import type { TapePoint } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function priceAtOrAfter(tape: TapePoint[], targetMs: number): number | null {
  for (const p of tape) {
    if (p.tradedAt.getTime() >= targetMs) return p.price;
  }
  return tape.length ? tape[tape.length - 1].price : null;
}

export function directionalRoi(
  entryPrice: number,
  currentPrice: number,
  outcomeSide: string,
): number {
  if (entryPrice <= 0 || currentPrice <= 0) return 0;
  const raw = (currentPrice - entryPrice) / entryPrice;
  const side = outcomeSide.toUpperCase();
  if (side === "NO" || side.startsWith("AGAINST_")) return -raw;
  return raw;
}

export function pnlFromRoi(roi: number, notional: number, fraction: number): number {
  return notional * fraction * roi;
}
