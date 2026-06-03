import type { SignalInputs } from "./types.js";

/** Higher = riskier (0–100). */
export function computeRiskScore(
  input: SignalInputs,
  openMarketIds: Set<string>,
  categoryExposurePct: number,
  maxCategoryExposurePct: number,
): number {
  let risk = 0;

  if (input.liquidityScore < 40) risk += 18;
  else if (input.liquidityScore < 60) risk += 8;

  if (input.slippageEstimate > 0.05) risk += 15;
  else if (input.slippageEstimate > 0.02) risk += 8;

  if (input.systemConfidenceScore < 45) risk += 20;
  else if (input.systemConfidenceScore < 60) risk += 10;

  if (input.disagreementScore > 0.35) risk += 15;

  if (openMarketIds.has(input.marketId)) risk += 25;

  if (input.marketQualityScore < 40) risk += 12;

  if (input.sparseData) risk += 10;
  if (input.staleSignal) risk += 12;

  if (
    input.category &&
    categoryExposurePct >= maxCategoryExposurePct * 0.85
  ) {
    risk += 10;
  }

  return Math.max(0, Math.min(100, risk));
}
