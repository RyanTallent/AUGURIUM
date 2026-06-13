import { COPY_RISK_LIMITS, buildExposureSnapshot } from "./copy-risk.js";

const MAX_SOURCE_ROI = Number(process.env.COPY_MAX_SOURCE_ROI_TO_MIRROR ?? "0.20");

/** ROI of a leader position (pnl / cost basis). */
export function leaderPositionRoi(pnl: number, size: number, avgPrice: number): number {
  const cost = Math.max(0.01, size * avgPrice);
  return pnl / cost;
}

/** Skip mirroring when the leader is already deep in profit (we're too late). */
export function isSourcePositionTooStale(pnl: number, size: number, avgPrice: number): boolean {
  return leaderPositionRoi(pnl, size, avgPrice) > MAX_SOURCE_ROI;
}

export function canAddMarketExposure(
  bankrollUsd: number,
  openRows: Array<{
    traderId: string;
    address: string;
    marketId: string;
    category: string | null;
    usd: number;
  }>,
  candidate: {
    traderId: string;
    address: string;
    marketId: string;
    category: string | null;
    usd: number;
  },
): { allowed: boolean; reason: string | null } {
  const snap = buildExposureSnapshot(bankrollUsd, [...openRows, candidate]);
  const marketPct =
    snap.marketExposure.find((m) => m.marketId === candidate.marketId)?.pct ?? 0;
  if (marketPct > COPY_RISK_LIMITS.maxCapitalPerMarketPct + 0.001) {
    return {
      allowed: false,
      reason: `market exposure would exceed ${COPY_RISK_LIMITS.maxCapitalPerMarketPct * 100}%`,
    };
  }
  const traderPct =
    snap.traderExposure.find((t) => t.traderId === candidate.traderId)?.pct ?? 0;
  if (traderPct > COPY_RISK_LIMITS.maxCapitalPerTraderPct + 0.001) {
    return {
      allowed: false,
      reason: `trader exposure would exceed ${COPY_RISK_LIMITS.maxCapitalPerTraderPct * 100}%`,
    };
  }
  return { allowed: true, reason: null };
}
