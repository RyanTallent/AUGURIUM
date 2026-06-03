export interface PortfolioConfig {
  initialTradingBankrollUsd: number;
  maxDeployedPct: number;
  preferredMinPositions: number;
  preferredMaxPositions: number;
  normalMaxPositionPct: number;
  exceptionalMaxPositionPct: number;
  absoluteHardCapPct: number;
  maxDailyLossUsd: number;
  maxCategoryExposurePct: number;
  drawdownTriggerPct: number;
  drawdownSizeMultiplier: number;
  reallocationScoreGap: number;
  profitReinvestPct: number;
  profitReservePct: number;
}

export function getPortfolioConfig(): PortfolioConfig {
  return {
    initialTradingBankrollUsd: Number(
      process.env.INITIAL_TRADING_BANKROLL_USD ?? "70",
    ),
    maxDeployedPct: 0.8,
    preferredMinPositions: 2,
    preferredMaxPositions: 5,
    normalMaxPositionPct: 0.15,
    exceptionalMaxPositionPct: 0.2,
    absoluteHardCapPct: 0.25,
    maxDailyLossUsd: Number(process.env.MAX_DAILY_LOSS_USD ?? "25"),
    maxCategoryExposurePct: Number(
      process.env.MAX_CATEGORY_EXPOSURE_PCT ?? "0.4",
    ),
    drawdownTriggerPct: 0.1,
    drawdownSizeMultiplier: 0.5,
    reallocationScoreGap: 10,
    profitReinvestPct: 0.6,
    profitReservePct: 0.4,
  };
}
