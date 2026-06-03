import type { PortfolioConfig } from "./config.js";

/** Base bankroll fraction from composite score tier. */
export function basePositionPctFromScore(compositeScore: number): number {
  if (compositeScore >= 95) return 0.1;
  if (compositeScore >= 90) return 0.08;
  if (compositeScore >= 85) return 0.06;
  if (compositeScore >= 80) return 0.04;
  return 0;
}

export interface SizingModifiers {
  systemConfidence: number;
  marketQuality: number;
  liquidityScore: number;
  drawdownMode: boolean;
  duplicateMarket: boolean;
  categoryOverCap: boolean;
}

export function applySizingModifiers(
  basePct: number,
  mod: SizingModifiers,
): { pct: number; reasons: string[] } {
  const reasons: string[] = [];
  let pct = basePct;
  if (pct <= 0) return { pct: 0, reasons: ["composite score below 80 — no allocation"] };

  if (mod.drawdownMode) {
    pct *= 0.5;
    reasons.push("drawdown mode: position size halved");
  }
  if (mod.systemConfidence < 50) {
    pct *= 0.7;
    reasons.push("low system confidence");
  }
  if (mod.marketQuality < 40) {
    pct *= 0.75;
    reasons.push("poor market quality");
  }
  if (mod.liquidityScore < 35) {
    pct *= 0.8;
    reasons.push("low liquidity");
  }
  if (mod.duplicateMarket) {
    pct = 0;
    reasons.push("duplicate market exposure blocked");
  }
  if (mod.categoryOverCap) {
    pct *= 0.5;
    reasons.push("category concentration cap");
  }

  return { pct: Math.max(0, pct), reasons };
}

export function clampPositionPct(
  pct: number,
  compositeScore: number,
  config: PortfolioConfig,
): { pct: number; exceptional: boolean } {
  const exceptional = compositeScore >= 92;
  const cap = exceptional
    ? config.exceptionalMaxPositionPct
    : config.normalMaxPositionPct;
  const clamped = Math.min(pct, cap, config.absoluteHardCapPct);
  return { pct: clamped, exceptional };
}

export function sizeUsdFromPct(tradingBankroll: number, pct: number): number {
  return tradingBankroll * pct;
}
