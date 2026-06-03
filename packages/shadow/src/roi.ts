/** Minimum plausible Polymarket outcome price for ROI math (avoids divide-by-tiny). */
export const MIN_PLAUSIBLE_PRICE = 0.02;
export const MAX_PLAUSIBLE_PRICE = 0.98;

export const ROI_ANOMALY_THRESHOLDS = [
  { key: "gt_100pct", minExclusive: 1 },
  { key: "gt_200pct", minExclusive: 2 },
  { key: "gt_500pct", minExclusive: 5 },
  { key: "gt_1000pct", minExclusive: 10 },
  { key: "gt_5000pct", minExclusive: 50 },
] as const;

export type RoiAnomalyKey = (typeof ROI_ANOMALY_THRESHOLDS)[number]["key"];

/** Capital deployed for shadow simulation (full notional at open). */
export function capitalAtRisk(simulatedSizeUsd: number): number {
  return Math.max(0, simulatedSizeUsd);
}

/**
 * Authoritative closed-trade ROI: realized PnL / capital at risk.
 * Matches exit-rules `safeTotalRoi` when PnL accounting is consistent.
 */
export function closedPositionRoi(realizedPnl: number, simulatedSizeUsd: number): number {
  const basis = capitalAtRisk(simulatedSizeUsd);
  if (basis <= 0) return 0;
  return realizedPnl / basis;
}

export function isPlausiblePrice(price: number): boolean {
  return price >= MIN_PLAUSIBLE_PRICE && price <= MAX_PLAUSIBLE_PRICE;
}

export function isPlausibleEntryPrice(entryPrice: number): boolean {
  return isPlausiblePrice(entryPrice);
}

/** Highest anomaly tier exceeded, or null if ROI is within normal bounds. */
export function roiAnomalyTier(roi: number): RoiAnomalyKey | null {
  let tier: RoiAnomalyKey | null = null;
  for (const t of ROI_ANOMALY_THRESHOLDS) {
    if (roi > t.minExclusive) tier = t.key;
  }
  return tier;
}

export function isCorruptRoi(roi: number): boolean {
  return roiAnomalyTier(roi) !== null;
}

export function storedRoiMismatch(
  storedRoi: number,
  authoritativeRoi: number,
  tolerance = 0.02,
): boolean {
  return Math.abs(storedRoi - authoritativeRoi) > tolerance;
}

export interface RoiAnomalySummary {
  counts: Record<RoiAnomalyKey, number>;
  contributionToMean: Record<RoiAnomalyKey, number>;
  corruptCount: number;
  sampleSize: number;
}

export function summarizeRoiAnomalies(rois: number[]): RoiAnomalySummary {
  const counts = Object.fromEntries(
    ROI_ANOMALY_THRESHOLDS.map((t) => [t.key, 0]),
  ) as Record<RoiAnomalyKey, number>;
  const contributionToMean = { ...counts };
  let corruptCount = 0;
  const mean = rois.length ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;

  for (const roi of rois) {
    const tier = roiAnomalyTier(roi);
    if (tier) {
      corruptCount++;
      counts[tier]++;
      contributionToMean[tier] += roi - mean;
    }
  }

  return { counts, contributionToMean, corruptCount, sampleSize: rois.length };
}
