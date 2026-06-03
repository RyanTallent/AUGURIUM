import type { SignalInputs } from "./types.js";

/** Weighted blend used for sizing tiers (0–100). */
export function computeCompositeScore(input: SignalInputs): number {
  const raw =
    input.alphaScore * 0.3 +
    input.consensusScore * 0.25 +
    input.systemConfidenceScore * 0.25 +
    input.marketQualityScore * 0.2;
  return Math.max(0, Math.min(100, raw));
}
