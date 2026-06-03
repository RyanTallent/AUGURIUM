import { prisma } from "./client.js";
import { closedPositionRoi, isPlausibleEntryPrice } from "@augurium/shadow";

export type ZeroRoiCategory =
  | "resolved_flat"
  | "expired_without_price"
  | "missing_exit_price"
  | "missing_entry_price"
  | "calculation_error"
  | "no_post_entry_trade"
  | "never_marked"
  | "other";

export interface ZeroRoiBreakdown {
  totalZeroRoi: number;
  totalClosed: number;
  pctOfClosed: number;
  byCategory: Record<ZeroRoiCategory, number>;
  generatedAt: string;
}

function classifyZeroRoiTrade(trade: {
  status: string;
  simulatedEntryPrice: number;
  currentPrice: number;
  realizedPnl: number;
  simulatedSizeUsd: number;
  roi: number;
  priceStatus: string;
  priceCheckReason: string | null;
  latestReasoning: string;
  market: { resolved: boolean; closed: boolean };
}): ZeroRoiCategory {
  const authRoi = closedPositionRoi(trade.realizedPnl, trade.simulatedSizeUsd);
  if (Math.abs(authRoi) >= 0.0001) return "other";

  if (!isPlausibleEntryPrice(trade.simulatedEntryPrice) || trade.simulatedEntryPrice <= 0) {
    return "missing_entry_price";
  }

  if (trade.currentPrice <= 0) return "missing_exit_price";

  if (
    trade.status === "EXPIRED" ||
    trade.latestReasoning.toLowerCase().includes("expired")
  ) {
    if (
      trade.priceStatus === "NO_PRICE_SOURCE" ||
      trade.priceStatus === "NO_PRICE_UPDATE"
    ) {
      return "expired_without_price";
    }
    return "expired_without_price";
  }

  if (trade.market.resolved || trade.market.closed) {
    if (Math.abs(trade.currentPrice - trade.simulatedEntryPrice) < 0.0001) {
      return "resolved_flat";
    }
  }

  if (
    trade.priceCheckReason?.includes("post-entry") ||
    trade.priceStatus === "NO_PRICE_UPDATE"
  ) {
    return "no_post_entry_trade";
  }

  if (trade.priceStatus === "NO_PRICE_SOURCE") {
    return "never_marked";
  }

  if (Math.abs(trade.roi - authRoi) > 0.05 && Math.abs(trade.realizedPnl) < 0.01) {
    return "calculation_error";
  }

  if (Math.abs(trade.currentPrice - trade.simulatedEntryPrice) < 0.0001) {
    return "no_post_entry_trade";
  }

  return "other";
}

export async function computeZeroRoiBreakdown(): Promise<ZeroRoiBreakdown> {
  const trades = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    select: {
      status: true,
      simulatedEntryPrice: true,
      currentPrice: true,
      realizedPnl: true,
      simulatedSizeUsd: true,
      roi: true,
      priceStatus: true,
      priceCheckReason: true,
      latestReasoning: true,
      market: { select: { resolved: true, closed: true } },
    },
  });

  const categories: Record<ZeroRoiCategory, number> = {
    resolved_flat: 0,
    expired_without_price: 0,
    missing_exit_price: 0,
    missing_entry_price: 0,
    calculation_error: 0,
    no_post_entry_trade: 0,
    never_marked: 0,
    other: 0,
  };

  let totalZeroRoi = 0;
  for (const t of trades) {
    const authRoi = closedPositionRoi(t.realizedPnl, t.simulatedSizeUsd);
    if (Math.abs(authRoi) >= 0.0001) continue;
    totalZeroRoi++;
    const cat = classifyZeroRoiTrade(t);
    categories[cat]++;
  }

  return {
    totalZeroRoi,
    totalClosed: trades.length,
    pctOfClosed: trades.length ? totalZeroRoi / trades.length : 0,
    byCategory: categories,
    generatedAt: new Date().toISOString(),
  };
}
