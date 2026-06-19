import { prisma } from "@augurium/database";
import { mapToSpecialtyBucket } from "@augurium/shared";

const COPY_BATCH = Number(process.env.POSITION_SYNC_COPY_BATCH ?? "12");
const TRADE_LIMIT = Number(process.env.US_POSITION_SYNC_TRADE_LIMIT ?? "500");

function positionExternalKey(wallet: string, slug: string, side: string): string {
  return `us:${wallet}:${slug}:${side}`;
}

type UsTradeRow = {
  slug: string | null;
  side: string;
  size: number;
  price: number;
  tradedAt: Date;
  market: { id: string; title: string; category: string | null } | null;
};

function netOpenPositions(trades: UsTradeRow[]): Array<{
  marketId: string;
  slug: string;
  side: string;
  size: number;
  avgPrice: number;
}> {
  const byKey = new Map<string, { marketId: string; slug: string; side: string; shares: number; cost: number }>();

  const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  for (const t of sorted) {
    const slug = t.slug?.trim();
    const marketId = t.market?.id;
    if (!slug || !marketId) continue;
    const key = `${slug}:${t.side}`;
    const row = byKey.get(key) ?? { marketId, slug, side: t.side, shares: 0, cost: 0 };
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
      slug: r.slug,
      side: r.side,
      size: r.shares,
      avgPrice: r.shares > 0 ? r.cost / r.shares : 0,
    }));
}

async function syncUsPositionsForTrader(trader: { id: string; address: string }): Promise<number> {
  const trades = await prisma.trade.findMany({
    where: { traderId: trader.id, source: "polymarket-us" },
    orderBy: { tradedAt: "desc" },
    take: TRADE_LIMIT,
    select: {
      slug: true,
      side: true,
      size: true,
      price: true,
      tradedAt: true,
      market: { select: { id: true, title: true, category: true } },
    },
  });

  const open = netOpenPositions(trades);
  let synced = 0;

  for (const pos of open) {
    const key = positionExternalKey(trader.address, pos.slug, pos.side);
    await prisma.position.upsert({
      where: { externalKey: key },
      create: {
        externalKey: key,
        traderId: trader.id,
        marketId: pos.marketId,
        conditionId: pos.slug,
        asset: pos.slug,
        side: pos.side,
        size: pos.size,
        avgPrice: pos.avgPrice,
        pnl: 0,
        source: "polymarket-us",
        status: "open",
        syncedAt: new Date(),
      },
      update: {
        marketId: pos.marketId,
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

/** Sync leader open positions from US trade history (not PolymarketScan). */
export async function syncPositionsFromUsData(opts?: { fastOnly?: boolean }): Promise<number> {
  const fastOnly = opts?.fastOnly === true;

  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: { evaluatedAt: "desc" },
    take: COPY_BATCH,
    include: { trader: true },
  });

  const traderById = new Map<string, { id: string; address: string }>();
  for (const c of controls) {
    traderById.set(c.trader.id, c.trader);
  }

  if (!fastOnly) {
    const candidates = await prisma.trader.findMany({
      where: {
        OR: [
          { discoveredVia: "polymarket-us-trades" },
          { tradeRows: { some: { source: "polymarket-us" } } },
        ],
        lastScoredAt: { not: null },
      },
      orderBy: { rankingScore: "desc" },
      take: COPY_BATCH,
      select: { id: true, address: true },
    });
    for (const t of candidates) traderById.set(t.id, t);
  }

  let synced = 0;
  for (const trader of traderById.values()) {
    try {
      synced += await syncUsPositionsForTrader(trader);
    } catch (err) {
      console.warn(
        `[position-sync:us] trader ${trader.address.slice(0, 10)}… failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[position-sync:us] mode=${fastOnly ? "fast" : "slow"} traders=${traderById.size} synced=${synced}`);
  return synced;
}

export async function ensureUsMarketForSlug(slug: string, title: string): Promise<string> {
  const externalId = `us:${slug}`;
  const row = await prisma.market.upsert({
    where: { externalId },
    create: {
      externalId,
      source: "polymarket-us",
      title,
      slug,
      category: mapToSpecialtyBucket({ title, slug }),
      active: true,
      closed: false,
      acceptingOrders: true,
    },
    update: { title, slug, active: true, closed: false },
  });
  return row.id;
}
