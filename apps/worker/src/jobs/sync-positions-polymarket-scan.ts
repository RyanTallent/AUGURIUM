import { prisma } from "@augurium/database";
import { positionExternalKey } from "../lib/polymarket.js";
import {
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  polymarketScanFetch,
  type ScanWalletTrade,
} from "../lib/polymarket-scan.js";

const TRADE_LIMIT = Number(process.env.POLYMARKET_SCAN_TRADES_LIMIT ?? "200");
const COPY_BATCH = Number(process.env.POSITION_SYNC_COPY_BATCH ?? "15");

async function ensureGlobalMarketForScanTrade(trade: ScanWalletTrade): Promise<string> {
  const externalId = trade.market.startsWith("0x") ? trade.market : `scan:${trade.market}`;
  const conditionId = trade.market.startsWith("0x") ? trade.market : null;

  const existing = await prisma.market.findFirst({
    where: {
      OR: [
        { externalId },
        ...(conditionId ? [{ conditionId }] : []),
      ],
    },
    select: { id: true, slug: true },
  });
  if (existing) {
    const eventSlug = trade.event_slug?.trim() || null;
    if (eventSlug && !existing.slug) {
      await prisma.market.update({
        where: { id: existing.id },
        data: { slug: eventSlug, eventSlug },
      });
    }
    return existing.id;
  }

  try {
    const row = await prisma.market.create({
      data: {
        externalId,
        conditionId,
        source: "polymarket",
        title: trade.market_question,
        slug: trade.event_slug ?? null,
        eventSlug: trade.event_slug ?? null,
        active: true,
      },
    });
    return row.id;
  } catch {
    const fallback = await prisma.market.findFirst({
      where: {
        OR: [
          { externalId },
          ...(conditionId ? [{ conditionId }] : []),
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new Error(`failed to resolve market for scan trade ${trade.market}`);
  }
}

function netPositionsFromTrades(trades: ScanWalletTrade[]): Array<{
  marketId: string;
  conditionId: string;
  side: string;
  size: number;
  avgPrice: number;
  pnl: number;
}> {
  const byKey = new Map<
    string,
    { marketId: string; conditionId: string; side: string; shares: number; cost: number }
  >();

  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );

  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const row = byKey.get(key) ?? {
      marketId: t.market,
      conditionId: t.market,
      side: t.outcome,
      shares: 0,
      cost: 0,
    };
    const signed = t.side === "SELL" ? -t.size : t.size;
    if (signed > 0) {
      row.cost += signed * t.price;
      row.shares += signed;
    } else {
      const sell = -signed;
      const avg = row.shares > 0 ? row.cost / row.shares : t.price;
      row.shares = Math.max(0, row.shares - sell);
      row.cost = row.shares * avg;
    }
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .filter((r) => r.shares > 0.01)
    .map((r) => ({
      marketId: r.marketId,
      conditionId: r.conditionId,
      side: r.side,
      size: r.shares,
      avgPrice: r.shares > 0 ? r.cost / r.shares : 0,
      pnl: 0,
    }));
}

export async function syncPositionsFromPolymarketScanForTrader(trader: {
  id: string;
  address: string;
}): Promise<number> {
  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet: trader.address,
    limit: TRADE_LIMIT,
  });
  await storeRawPayload(
    "polymarket-scan",
    `wallet_trades?wallet=${trader.address}`,
    res,
  );

  if (!res.ok || !res.data) return 0;

  const nets = netPositionsFromTrades(res.data);
  let synced = 0;

  for (const pos of nets) {
    const sample = res.data.find((t) => t.market === pos.conditionId);
    const marketId = await ensureGlobalMarketForScanTrade({
      market: pos.conditionId,
      market_question: sample?.market_question ?? pos.side,
      event_slug: sample?.event_slug,
      outcome: pos.side,
      side: "BUY",
      price: pos.avgPrice,
      size: pos.size,
      trade_timestamp: new Date().toISOString(),
      transaction_hash: `scan:${trader.address}:${pos.conditionId}`,
    });

    const key = positionExternalKey(trader.address, pos.conditionId, pos.side);
    await prisma.position.upsert({
      where: { externalKey: key },
      create: {
        externalKey: key,
        traderId: trader.id,
        marketId,
        conditionId: pos.conditionId,
        side: pos.side,
        size: pos.size,
        avgPrice: pos.avgPrice,
        pnl: pos.pnl,
        source: "polymarket-scan",
        status: "open",
        syncedAt: new Date(),
      },
      update: {
        marketId,
        size: pos.size,
        avgPrice: pos.avgPrice,
        status: "open",
        syncedAt: new Date(),
      },
    });
    synced++;
  }

  return synced;
}

/** Sync open leader positions from PolymarketScan wallet_trades for COPY-enabled traders. */
export async function syncPositionsFromPolymarketScan(): Promise<number> {
  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: { evaluatedAt: "desc" },
    take: COPY_BATCH,
    include: { trader: true },
  });

  let synced = 0;
  for (const c of controls) {
    synced += await syncPositionsFromPolymarketScanForTrader(c.trader);
  }

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    take: COPY_BATCH,
  });
  for (const w of watchlist) {
    const traderId = await upsertTraderFromWallet(w.wallet, "polymarket-scan-watchlist");
    synced += await syncPositionsFromPolymarketScanForTrader({
      id: traderId,
      address: w.wallet,
    });
  }

  if (controls.length > 0 || watchlist.length > 0) {
    console.log(
      `[position-sync:scan] ${synced} positions for ${controls.length} COPY + ${watchlist.length} watchlist trader(s)`,
    );
  }
  return synced;
}
