import { prisma } from "@augurium/database";
import type { TapePoint } from "@augurium/shadow";
import { buildMarketTapeForMarket } from "./market-tapes.js";

export interface MarketTradeQuote {
  price: number;
  tradedAt: Date;
  source: "market_outcome" | "condition_outcome" | "market_any" | "condition_any";
}

export interface ShadowPriceSources {
  tape: TapePoint[];
  marketOutcomeTrade: MarketTradeQuote | null;
  conditionOutcomeTrade: MarketTradeQuote | null;
  marketSnapshotPrice: number | null;
  marketSnapshotTradedAt: Date | null;
  snapshotSource: "market_outcome" | "market_any" | null;
}

function normalizeOutcome(side: string): string {
  return side.toUpperCase();
}

function toQuote(
  row: { price: number; tradedAt: Date } | null,
  source: MarketTradeQuote["source"],
): MarketTradeQuote | null {
  if (!row || row.price <= 0) return null;
  return { price: row.price, tradedAt: row.tradedAt, source };
}

/** Latest ingested trade for market + outcome (YES/NO), then any market trade. */
export async function latestTradeByMarketAndOutcome(
  marketId: string,
  outcomeSide: string,
): Promise<{ outcome: MarketTradeQuote | null; any: MarketTradeQuote | null }> {
  const outcome = normalizeOutcome(outcomeSide);
  const outcomeRow = await prisma.trade.findFirst({
    where: {
      marketId,
      outcome: { equals: outcome, mode: "insensitive" },
    },
    orderBy: { tradedAt: "desc" },
    select: { price: true, tradedAt: true },
  });
  const anyRow = await prisma.trade.findFirst({
    where: { marketId },
    orderBy: { tradedAt: "desc" },
    select: { price: true, tradedAt: true },
  });
  return {
    outcome: toQuote(outcomeRow, "market_outcome"),
    any: toQuote(anyRow, "market_any"),
  };
}

/** Latest trade for conditionId + outcome, then any condition trade. */
export async function latestTradeByConditionAndOutcome(
  conditionId: string,
  outcomeSide: string,
): Promise<{ outcome: MarketTradeQuote | null; any: MarketTradeQuote | null }> {
  const outcome = normalizeOutcome(outcomeSide);
  const outcomeRow = await prisma.trade.findFirst({
    where: {
      conditionId,
      outcome: { equals: outcome, mode: "insensitive" },
    },
    orderBy: { tradedAt: "desc" },
    select: { price: true, tradedAt: true },
  });
  const anyRow = await prisma.trade.findFirst({
    where: { conditionId },
    orderBy: { tradedAt: "desc" },
    select: { price: true, tradedAt: true },
  });
  return {
    outcome: toQuote(outcomeRow, "condition_outcome"),
    any: toQuote(anyRow, "condition_any"),
  };
}

export async function loadShadowPriceSources(input: {
  marketId: string;
  conditionId: string | null;
  outcomeSide: string;
}): Promise<ShadowPriceSources> {
  const normalized = normalizeOutcome(input.outcomeSide);
  const recent = await prisma.trade.findMany({
    where: { marketId: input.marketId },
    orderBy: { tradedAt: "desc" },
    take: 50,
    select: { conditionId: true, asset: true, outcome: true, price: true, tradedAt: true },
  });

  let tape: TapePoint[] = [];
  if (recent.length > 0) {
    const match =
      recent.find((t) => (t.outcome ?? "").toUpperCase() === normalized) ?? recent[0];
    const cid = input.conditionId ?? match.conditionId;
    tape = await buildMarketTapeForMarket(input.marketId, cid, match.asset);
  }

  const [byMarket, byCondition] = await Promise.all([
    latestTradeByMarketAndOutcome(input.marketId, input.outcomeSide),
    input.conditionId
      ? latestTradeByConditionAndOutcome(input.conditionId, input.outcomeSide)
      : Promise.resolve({ outcome: null, any: null }),
  ]);

  const marketOutcomeTrade = byMarket.outcome ?? byCondition.outcome;
  const conditionOutcomeTrade =
    byCondition.outcome && byCondition.outcome !== marketOutcomeTrade
      ? byCondition.outcome
      : null;

  const snapshot =
    marketOutcomeTrade ??
    conditionOutcomeTrade ??
    byMarket.any ??
    byCondition.any;

  return {
    tape,
    marketOutcomeTrade: byMarket.outcome,
    conditionOutcomeTrade: byCondition.outcome,
    marketSnapshotPrice: snapshot?.price ?? null,
    marketSnapshotTradedAt: snapshot?.tradedAt ?? null,
    snapshotSource: snapshot?.source.startsWith("market")
      ? snapshot.source === "market_outcome"
        ? "market_outcome"
        : "market_any"
      : snapshot?.source === "condition_outcome"
        ? "market_outcome"
        : snapshot
          ? "market_any"
          : null,
  };
}

/** Pick best real trade for resolveShadowPrice (outcome-aware, newest first). */
export function bestMarketLatestTrade(
  sources: ShadowPriceSources,
): { tradedAt: Date; price: number; reason: string } | null {
  const candidates: { tradedAt: Date; price: number; reason: string }[] = [];
  if (sources.marketOutcomeTrade) {
    candidates.push({
      ...sources.marketOutcomeTrade,
      reason: `market_outcome:${sources.marketOutcomeTrade.source}`,
    });
  }
  if (sources.conditionOutcomeTrade) {
    candidates.push({
      ...sources.conditionOutcomeTrade,
      reason: `condition_outcome:${sources.conditionOutcomeTrade.source}`,
    });
  }
  if (sources.marketSnapshotTradedAt && sources.marketSnapshotPrice) {
    candidates.push({
      tradedAt: sources.marketSnapshotTradedAt,
      price: sources.marketSnapshotPrice,
      reason: sources.snapshotSource
        ? `snapshot_${sources.snapshotSource}`
        : "snapshot_fallback",
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.tradedAt.getTime() - a.tradedAt.getTime());
  return candidates[0]!;
}

export function priceCheckReasonForResult(
  priced: { priceStatus: string; priceSource: string | null; lastPriceUpdateAt: Date | null },
  tradeReason: string | null,
  staleAfterMs: number,
  now: Date,
): string {
  if (priced.priceStatus === "FRESH") {
    return tradeReason ? `fresh:${tradeReason}` : `fresh:${priced.priceSource ?? "unknown"}`;
  }
  if (priced.priceStatus === "STALE") {
    if (priced.lastPriceUpdateAt) {
      const ageMs = now.getTime() - priced.lastPriceUpdateAt.getTime();
      if (ageMs > staleAfterMs) {
        return `stale:trade_age_${Math.round(ageMs / 60_000)}m_gt_${Math.round(staleAfterMs / 60_000)}m`;
      }
    }
    return tradeReason ? `stale:${tradeReason}` : `stale:${priced.priceSource ?? "unknown"}`;
  }
  if (priced.priceStatus === "NO_PRICE_UPDATE") {
    return "no_update:no_new_trade_since_last_mark";
  }
  return "no_source:no_ingested_trades_for_outcome";
}
