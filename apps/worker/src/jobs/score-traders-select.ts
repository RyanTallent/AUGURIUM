export interface ScoreTraderCandidate {
  id: string;
  trades: number;
  lastScoredAt: Date | null;
  lastActivityAt: Date | null;
}

export interface PickTradersOptions {
  batchSize: number;
  minTrades: number;
  rescoreCooldownMs: number;
  lowValueMaxTrades: number;
  lowValueRescoreCooldownMs: number;
  now?: Date;
}

export function isEligibleForScoring(
  trader: { trades: number },
  minTrades: number,
): boolean {
  return trader.trades >= minTrades;
}

export function shouldRescoreTrader(
  trader: Pick<ScoreTraderCandidate, "trades" | "lastScoredAt" | "lastActivityAt">,
  opts: Pick<
    PickTradersOptions,
    "rescoreCooldownMs" | "lowValueMaxTrades" | "lowValueRescoreCooldownMs" | "now"
  >,
): boolean {
  if (!trader.lastScoredAt || !trader.lastActivityAt) return false;
  if (trader.lastActivityAt <= trader.lastScoredAt) return false;
  const now = opts.now ?? new Date();
  const ageMs = now.getTime() - trader.lastScoredAt.getTime();
  const cooldownMs =
    trader.trades < opts.lowValueMaxTrades
      ? opts.lowValueRescoreCooldownMs
      : opts.rescoreCooldownMs;
  return ageMs >= cooldownMs;
}

/** Unscored first, then rescore wallets with new activity past cooldown. */
export function pickTradersForScoring<T extends ScoreTraderCandidate>(
  unscored: T[],
  rescoreCandidates: T[],
  options: PickTradersOptions,
): T[] {
  const picked: T[] = [];
  for (const t of unscored) {
    if (!isEligibleForScoring(t, options.minTrades)) continue;
    picked.push(t);
    if (picked.length >= options.batchSize) return picked;
  }

  for (const t of rescoreCandidates) {
    if (picked.length >= options.batchSize) break;
    if (!isEligibleForScoring(t, options.minTrades)) continue;
    if (shouldRescoreTrader(t, options)) picked.push(t);
  }

  return picked;
}
