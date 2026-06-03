import { prisma } from "./client.js";
import {
  closedPositionRoi,
  ROI_ANOMALY_THRESHOLDS,
  roiAnomalyTier,
  storedRoiMismatch,
  summarizeRoiAnomalies,
  type RoiAnomalyKey,
} from "@augurium/shadow";

export interface ShadowTradeForensicRow {
  id: string;
  marketId: string;
  marketTitle: string;
  side: string;
  signalType: string;
  status: string;
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  positionSize: number;
  realizedPnl: number;
  storedRoi: number;
  authoritativeRoi: number;
  roiMismatch: boolean;
  anomalyTier: RoiAnomalyKey | null;
  marketResolved: boolean;
  closeReason: string;
}

export interface ShadowRoiForensicsReport {
  sampleSize: number;
  anomalyBuckets: Record<
    RoiAnomalyKey,
    { count: number; contributionToMean: number; pctOfSample: number }
  >;
  corruptTradeCount: number;
  meanStoredRoi: number;
  meanAuthoritativeRoi: number;
  meanAuthoritativeRoiExcludingAnomalies: number;
  diagnosis: "outlier_corruption" | "engine_mismatch" | "mixed" | "healthy";
  topAnomalies: ShadowTradeForensicRow[];
  engineMismatchCount: number;
  generatedAt: string;
}

function parseCloseReason(latestReasoning: string, status: string): string {
  const closed = latestReasoning.match(/Closed:\s*([^.|]+)/i);
  if (closed) return closed[1]!.trim();
  if (status === "EXPIRED") return "signal expired";
  return status.toLowerCase();
}

export async function computeShadowRoiForensics(
  limit = 2000,
): Promise<ShadowRoiForensicsReport> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    include: {
      market: { select: { title: true, resolved: true, closed: true } },
    },
    take: limit,
    orderBy: { closedAt: "desc" },
  });

  const eligible = trades.filter((t) => !t.invalidForAnalytics);

  const rows: ShadowTradeForensicRow[] = eligible.map((t) => {
    const costBasis = t.simulatedSizeUsd;
    const authoritativeRoi = closedPositionRoi(t.realizedPnl, costBasis);
    const exitPrice = t.currentPrice;
    return {
      id: t.id,
      marketId: t.marketId,
      marketTitle: t.market.title,
      side: t.side,
      signalType: t.signalType,
      status: t.status,
      entryPrice: t.simulatedEntryPrice,
      exitPrice,
      costBasis,
      positionSize: t.positionRemaining,
      realizedPnl: t.realizedPnl,
      storedRoi: t.roi,
      authoritativeRoi,
      roiMismatch: storedRoiMismatch(t.roi, authoritativeRoi),
      anomalyTier: roiAnomalyTier(authoritativeRoi) ?? roiAnomalyTier(t.roi),
      marketResolved: t.market.resolved || t.market.closed,
      closeReason: parseCloseReason(t.latestReasoning, t.status),
    };
  });

  const authoritativeRois = rows.map((r) => r.authoritativeRoi);
  const storedRois = rows.map((r) => r.storedRoi);
  const summary = summarizeRoiAnomalies(authoritativeRois);
  const engineMismatchCount = rows.filter((r) => r.roiMismatch).length;

  const trustworthy = authoritativeRois.filter((r) => !roiAnomalyTier(r));
  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const anomalyBuckets = Object.fromEntries(
    ROI_ANOMALY_THRESHOLDS.map((t) => {
      const count = summary.counts[t.key];
      return [
        t.key,
        {
          count,
          contributionToMean: summary.contributionToMean[t.key],
          pctOfSample: rows.length ? count / rows.length : 0,
        },
      ];
    }),
  ) as ShadowRoiForensicsReport["anomalyBuckets"];

  let diagnosis: ShadowRoiForensicsReport["diagnosis"] = "healthy";
  if (summary.corruptCount > 0 && engineMismatchCount > summary.corruptCount * 0.5) {
    diagnosis = "engine_mismatch";
  } else if (summary.corruptCount > 0 && engineMismatchCount > 0) {
    diagnosis = "mixed";
  } else if (summary.corruptCount > 0) {
    diagnosis = "outlier_corruption";
  }

  const topAnomalies = [...rows]
    .sort((a, b) => Math.abs(b.authoritativeRoi) - Math.abs(a.authoritativeRoi))
    .filter((r) => r.anomalyTier != null)
    .slice(0, 25);

  return {
    sampleSize: eligible.length,
    anomalyBuckets,
    corruptTradeCount: summary.corruptCount,
    meanStoredRoi: mean(storedRois),
    meanAuthoritativeRoi: mean(authoritativeRois),
    meanAuthoritativeRoiExcludingAnomalies: mean(trustworthy),
    diagnosis,
    topAnomalies,
    engineMismatchCount,
    generatedAt: new Date().toISOString(),
  };
}

export async function listShadowForensicRows(options: {
  filter?: "anomaly" | "zero" | "bottom" | "top";
  limit?: number;
}): Promise<ShadowTradeForensicRow[]> {
  const report = await computeShadowRoiForensics(5000);
  const all = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    include: { market: { select: { title: true, resolved: true, closed: true } } },
    orderBy: { closedAt: "desc" },
    take: 5000,
  });

  const rows: ShadowTradeForensicRow[] = all.map((t) => {
    const authoritativeRoi = closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd);
    return {
      id: t.id,
      marketId: t.marketId,
      marketTitle: t.market.title,
      side: t.side,
      signalType: t.signalType,
      status: t.status,
      entryPrice: t.simulatedEntryPrice,
      exitPrice: t.currentPrice,
      costBasis: t.simulatedSizeUsd,
      positionSize: t.positionRemaining,
      realizedPnl: t.realizedPnl,
      storedRoi: t.roi,
      authoritativeRoi,
      roiMismatch: storedRoiMismatch(t.roi, authoritativeRoi),
      anomalyTier: roiAnomalyTier(authoritativeRoi) ?? roiAnomalyTier(t.roi),
      marketResolved: t.market.resolved || t.market.closed,
      closeReason: parseCloseReason(t.latestReasoning, t.status),
    };
  });

  const limit = options.limit ?? 50;
  switch (options.filter) {
    case "anomaly":
      return rows.filter((r) => r.anomalyTier).slice(0, limit);
    case "zero":
      return rows.filter((r) => Math.abs(r.authoritativeRoi) < 0.0001).slice(0, limit);
    case "bottom":
      return [...rows].sort((a, b) => a.authoritativeRoi - b.authoritativeRoi).slice(0, limit);
    case "top":
    default:
      return [...rows].sort((a, b) => b.authoritativeRoi - a.authoritativeRoi).slice(0, limit);
  }
}
