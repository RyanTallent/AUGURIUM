import { prisma } from "@augurium/database";
import type { TapePoint } from "@augurium/shadow";
import {
  bestMarketLatestTrade,
  type MarketTradeQuote,
  type ShadowPriceSources,
} from "./shadow-price-sources.js";

const MAX_RECENT_PER_MARKET = Number(process.env.SHADOW_RECENT_TRADES_PER_MARKET ?? "40");
const MAX_TAPE_POINTS = Number(process.env.SHADOW_TAPE_MAX_POINTS ?? "300");

export interface ShadowSyncRow {
  marketId: string;
  conditionId: string | null;
  side: string;
}

type TradeRow = {
  marketId: string | null;
  conditionId: string;
  asset: string;
  outcome: string | null;
  price: number;
  tradedAt: Date;
};

export interface BatchPriceContext {
  sourcesFor(shadow: ShadowSyncRow): ShadowPriceSources;
}

function normalizeOutcome(side: string): string {
  return side.toUpperCase();
}

function toQuote(
  row: { price: number; tradedAt: Date } | undefined,
  source: MarketTradeQuote["source"],
): MarketTradeQuote | null {
  if (!row || row.price <= 0) return null;
  return { price: row.price, tradedAt: row.tradedAt, source };
}

function groupRecentByMarket(rows: TradeRow[]): Map<string, TradeRow[]> {
  const map = new Map<string, TradeRow[]>();
  for (const row of rows) {
    if (!row.marketId) continue;
    const list = map.get(row.marketId) ?? [];
    if (list.length >= MAX_RECENT_PER_MARKET) continue;
    list.push(row);
    map.set(row.marketId, list);
  }
  return map;
}

function latestFromRows(
  rows: TradeRow[],
  outcomeSide: string,
): { outcome: MarketTradeQuote | null; any: MarketTradeQuote | null } {
  const outcome = normalizeOutcome(outcomeSide);
  let outcomeRow: TradeRow | undefined;
  let anyRow: TradeRow | undefined;
  for (const row of rows) {
    if (!anyRow) anyRow = row;
    if ((row.outcome ?? "").toUpperCase() === outcome) {
      outcomeRow = row;
      break;
    }
  }
  return {
    outcome: toQuote(outcomeRow, "market_outcome"),
    any: toQuote(anyRow, "market_any"),
  };
}

function buildTapeFromRows(rows: TradeRow[], conditionId: string, asset: string): TapePoint[] {
  const filtered = rows
    .filter((r) => r.conditionId === conditionId && r.asset === asset)
    .sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const slice =
    filtered.length > MAX_TAPE_POINTS
      ? filtered.slice(filtered.length - MAX_TAPE_POINTS)
      : filtered;
  return slice.map((r) => ({ tradedAt: r.tradedAt, price: r.price }));
}

/** Preload trades for a chunk (avoids per-shadow tape queries). */
export async function buildBatchPriceContext(
  shadows: ShadowSyncRow[],
): Promise<BatchPriceContext> {
  const marketIds = [...new Set(shadows.map((s) => s.marketId))];
  const conditionIds = [
    ...new Set(shadows.map((s) => s.conditionId).filter((c): c is string => c != null)),
  ];

  const marketIdFilter =
    marketIds.length > 0 ? { marketId: { in: marketIds } } : { marketId: "__none__" };

  const [marketTrades, conditionTrades] = await Promise.all([
    marketIds.length > 0
      ? prisma.trade.findMany({
          where: marketIdFilter,
          select: {
            marketId: true,
            conditionId: true,
            asset: true,
            outcome: true,
            price: true,
            tradedAt: true,
          },
          orderBy: { tradedAt: "desc" },
          take: Math.min(marketIds.length * MAX_RECENT_PER_MARKET, 8000),
        })
      : Promise.resolve([]),
    conditionIds.length > 0
      ? prisma.trade.findMany({
          where: { conditionId: { in: conditionIds } },
          select: {
            marketId: true,
            conditionId: true,
            asset: true,
            outcome: true,
            price: true,
            tradedAt: true,
          },
          orderBy: { tradedAt: "desc" },
          take: Math.min(conditionIds.length * MAX_RECENT_PER_MARKET, 4000),
        })
      : Promise.resolve([]),
  ]);

  const recentByMarket = groupRecentByMarket(marketTrades);
  const recentByCondition = new Map<string, TradeRow[]>();
  for (const row of conditionTrades) {
    const list = recentByCondition.get(row.conditionId) ?? [];
    if (list.length >= MAX_RECENT_PER_MARKET) continue;
    list.push(row);
    recentByCondition.set(row.conditionId, list);
  }

  const tapeCache = new Map<string, TapePoint[]>();

  return {
    sourcesFor(shadow: ShadowSyncRow): ShadowPriceSources {
      const normalized = normalizeOutcome(shadow.side);
      const recent = recentByMarket.get(shadow.marketId) ?? [];
      const match =
        recent.find((t) => (t.outcome ?? "").toUpperCase() === normalized) ?? recent[0];
      const cid = shadow.conditionId ?? match?.conditionId;
      const asset = match?.asset;

      let tape: TapePoint[] = [];
      if (cid && asset) {
        const tapeKey = `${shadow.marketId}:${cid}:${asset}`;
        let cached = tapeCache.get(tapeKey);
        if (!cached) {
          cached = buildTapeFromRows(recent, cid, asset);
          tapeCache.set(tapeKey, cached);
        }
        tape = cached;
      }

      const byMarket = latestFromRows(recent, shadow.side);
      const byCondition = shadow.conditionId
        ? latestFromRows(recentByCondition.get(shadow.conditionId) ?? [], shadow.side)
        : { outcome: null, any: null };

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
          : snapshot
            ? "market_any"
            : null,
      };
    },
  };
}

export { bestMarketLatestTrade };
