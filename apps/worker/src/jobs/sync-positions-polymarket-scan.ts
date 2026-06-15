import { prisma } from "@augurium/database";
import { mapToSpecialtyBucket } from "@augurium/shared";
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
const COPY_BATCH = Number(process.env.POSITION_SYNC_COPY_BATCH ?? "8");
const GATE_SYNC_BATCH = Number(process.env.COPY_US_GATE_REFRESH_LIMIT ?? "12");
const SYNC_BATCH = Math.max(COPY_BATCH, GATE_SYNC_BATCH);
const MAX_OPEN_POSITIONS = Number(process.env.POSITION_SYNC_MAX_OPEN ?? "12");

/** DB-only — no Gamma/US API (scan sync must stay fast on Render). */
async function ensureGlobalMarketForScanTrade(trade: ScanWalletTrade): Promise<string | null> {
  const title =
    trade.market_question?.trim() ||
    `Scan market ${trade.market.slice(0, Math.min(12, trade.market.length))}`;
  const eventSlug = trade.event_slug?.trim() || null;
  const category = mapToSpecialtyBucket({ title, slug: eventSlug });
  const isCondition = trade.market.startsWith("0x");
  const externalId = isCondition ? trade.market : `scan:${trade.market}`;

  const existing = await prisma.market.findFirst({
    where: {
      OR: isCondition
        ? [{ conditionId: trade.market }, { externalId: trade.market }]
        : [{ externalId }],
    },
    select: { id: true, slug: true },
  });
  if (existing) {
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
        conditionId: isCondition ? trade.market : null,
        source: "polymarket-scan",
        title,
        slug: eventSlug,
        eventSlug,
        category,
        active: true,
      },
    });
    return row.id;
  } catch (err) {
    const recovered = await prisma.market.findFirst({
      where: {
        OR: isCondition
          ? [{ conditionId: trade.market }, { externalId }]
          : [{ externalId }],
      },
      select: { id: true },
    });
    if (recovered) return recovered.id;
    console.warn(
      `[position-sync:scan] market resolve failed market=${trade.market} title="${title.slice(0, 48)}"`,
      err instanceof Error ? err.message : err,
    );
    return null;
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
  const short = trader.address.slice(0, 10);
  const started = Date.now();
  console.log(`[position-sync:scan] wallet ${short}… fetch start`);

  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet: trader.address,
    limit: TRADE_LIMIT,
  });
  await storeRawPayload(
    "polymarket-scan",
    `wallet_trades?wallet=${trader.address}`,
    res,
  );

  if (!res.ok || !res.data) {
    console.log(`[position-sync:scan] wallet ${short}… no trades ms=${Date.now() - started}`);
    return 0;
  }

  const nets = netPositionsFromTrades(res.data).slice(0, MAX_OPEN_POSITIONS);
  let synced = 0;

  for (const pos of nets) {
    const sample =
      res.data.find((t) => t.market === pos.conditionId && t.outcome === pos.side) ??
      res.data.find((t) => t.market === pos.conditionId);
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
    if (!marketId) continue;

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

  console.log(
    `[position-sync:scan] wallet ${short}… open=${nets.length} synced=${synced} ms=${Date.now() - started}`,
  );
  return synced;
}

/** Sync open leader positions from PolymarketScan wallet_trades for COPY-enabled traders. */
export async function syncPositionsFromPolymarketScan(): Promise<number> {
  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: { evaluatedAt: "desc" },
    take: SYNC_BATCH,
    include: { trader: true },
  });

  const scanLeaders = await prisma.trader.findMany({
    where: { discoveredVia: "polymarket-scan", lastScoredAt: { not: null } },
    orderBy: { rankingScore: "desc" },
    take: SYNC_BATCH,
    select: { id: true, address: true },
  });

  const traderById = new Map<string, { id: string; address: string }>();
  for (const c of controls) {
    traderById.set(c.trader.id, c.trader);
  }
  for (const t of scanLeaders) {
    traderById.set(t.id, t);
  }

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    take: SYNC_BATCH,
  });

  console.log(
    `[position-sync:scan] batch leaders=${traderById.size} watchlist=${watchlist.length} maxOpen=${MAX_OPEN_POSITIONS}`,
  );

  let synced = 0;
  let index = 0;
  const total = traderById.size;
  for (const trader of traderById.values()) {
    index++;
    try {
      const n = await syncPositionsFromPolymarketScanForTrader(trader);
      synced += n;
      console.log(`[position-sync:scan] progress ${index}/${total}`);
    } catch (err) {
      console.warn(
        `[position-sync:scan] trader ${trader.address.slice(0, 10)}… failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const w of watchlist) {
    try {
      const traderId = await upsertTraderFromWallet(w.wallet, "polymarket-scan-watchlist");
      synced += await syncPositionsFromPolymarketScanForTrader({
        id: traderId,
        address: w.wallet,
      });
    } catch (err) {
      console.warn(
        `[position-sync:scan] watchlist ${w.wallet.slice(0, 10)}… failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (traderById.size > 0 || watchlist.length > 0) {
    console.log(
      `[position-sync:scan] done total=${synced} positions for ${traderById.size} leader(s) + ${watchlist.length} watchlist`,
    );
  }
  return synced;
}
