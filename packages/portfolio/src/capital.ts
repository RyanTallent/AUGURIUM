import type { PortfolioConfig } from "./config.js";
import type { ProfitSplit } from "./types.js";

export function splitProfits(
  profitUsd: number,
  config: PortfolioConfig,
): ProfitSplit {
  if (profitUsd <= 0) return { reinvestUsd: 0, reserveUsd: 0 };
  return {
    reinvestUsd: profitUsd * config.profitReinvestPct,
    reserveUsd: profitUsd * config.profitReservePct,
  };
}

export function applyLoss(tradingBankroll: number, lossUsd: number): number {
  return Math.max(0, tradingBankroll - Math.abs(lossUsd));
}
