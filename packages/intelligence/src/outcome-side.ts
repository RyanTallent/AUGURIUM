import type { ConsensusTradeInput } from "./types.js";

/** Normalize outcome label for grouping (YES/NO or named outcome). */
export function normalizeOutcomeSide(outcome: string | null | undefined): string {
  if (!outcome) return "UNKNOWN";
  const u = outcome.trim().toUpperCase();
  if (u === "YES" || u === "NO") return u;
  return outcome.trim();
}

/**
 * Which outcome side this trade supports (weighted consensus bucket).
 * BUY supports the stated outcome; SELL supports the opposite on binary markets.
 */
export function supportedOutcomeSide(trade: ConsensusTradeInput): string | null {
  const outcome = normalizeOutcomeSide(trade.outcome);
  if (outcome === "UNKNOWN") return null;

  const buy = trade.side.toUpperCase() === "BUY";
  if (outcome === "YES") return buy ? "YES" : "NO";
  if (outcome === "NO") return buy ? "NO" : "YES";

  return buy ? outcome : `AGAINST_${outcome}`;
}
