import type { PortfolioConfig } from "./config.js";
import type { OpenPositionView } from "./types.js";

export function deployedPct(
  deployedCapital: number,
  tradingBankroll: number,
): number {
  if (tradingBankroll <= 0) return 0;
  return deployedCapital / tradingBankroll;
}

export function isMaxDeployed(
  deployedCapital: number,
  tradingBankroll: number,
  config: PortfolioConfig,
): boolean {
  return deployedPct(deployedCapital, tradingBankroll) >= config.maxDeployedPct - 0.001;
}

export function categoryExposure(
  positions: OpenPositionView[],
  category: string | null,
  tradingBankroll: number,
): number {
  if (!category || tradingBankroll <= 0) return 0;
  const catDeployed = positions
    .filter((p) => p.category === category)
    .reduce((s, p) => s + p.allocatedUsd, 0);
  return catDeployed / tradingBankroll;
}

export function wouldExceedDeployedCap(
  deployedCapital: number,
  addUsd: number,
  tradingBankroll: number,
  config: PortfolioConfig,
): boolean {
  const next = (deployedCapital + addUsd) / Math.max(tradingBankroll, 1);
  return next > config.maxDeployedPct + 0.001;
}

export function findWeakestPosition(
  positions: OpenPositionView[],
): OpenPositionView | null {
  if (!positions.length) return null;
  return positions.reduce((a, b) =>
    a.compositeScore <= b.compositeScore ? a : b,
  );
}
