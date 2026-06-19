import { prisma } from "@augurium/database";
import { mapToSpecialtyBucket, polymarketScanFetch, type ScanWalletTrade } from "@augurium/shared";
import { matchUsMarketFromCatalog } from "@augurium/execution";

export type UsCatalogEntry = {
  marketId: string;
  title: string;
  category: string | null;
  slug: string;
};

export type ResolvedUsMarket = UsCatalogEntry & {
  confidence: number;
  reason: string;
};

const TRADE_LIMIT = Number(process.env.US_SCAN_TRADES_LIMIT ?? "200");
const MATCH_CACHE = new Map<string, ResolvedUsMarket | null>();

export async function loadUsCatalogSlugIndex(): Promise<Map<string, UsCatalogEntry>> {
  const markets = await prisma.market.findMany({
    where: { source: "polymarket-us", active: true, slug: { not: null } },
    select: { id: true, title: true, slug: true, eventSlug: true, category: true },
  });

  const index = new Map<string, UsCatalogEntry>();
  for (const m of markets) {
    const slug = m.slug?.trim().toLowerCase();
    if (!slug) continue;
    const entry: UsCatalogEntry = {
      marketId: m.id,
      title: m.title,
      category: m.category,
      slug,
    };
    index.set(slug, entry);
    const eventSlug = m.eventSlug?.trim().toLowerCase();
    if (eventSlug) index.set(eventSlug, entry);
  }
  return index;
}

export async function resolveScanTradeToUsMarket(
  trade: ScanWalletTrade,
  slugIndex: Map<string, UsCatalogEntry>,
): Promise<ResolvedUsMarket | null> {
  const eventSlug = trade.event_slug?.trim().toLowerCase() ?? "";
  if (eventSlug) {
    const direct = slugIndex.get(eventSlug);
    if (direct) {
      return { ...direct, confidence: 1, reason: "event_slug exact match" };
    }
  }

  const title = trade.market_question?.trim() || trade.market;
  const cacheKey = `${eventSlug}|${title}`;
  if (MATCH_CACHE.has(cacheKey)) return MATCH_CACHE.get(cacheKey) ?? null;

  const category = mapToSpecialtyBucket({ title, slug: eventSlug || null });
  const match = await matchUsMarketFromCatalog({
    title,
    slug: eventSlug || null,
    category,
  });

  if (!match.slug || match.confidence < 0.9) {
    MATCH_CACHE.set(cacheKey, null);
    return null;
  }

  const catalog = slugIndex.get(match.slug.toLowerCase());
  if (!catalog) {
    const row = await prisma.market.findFirst({
      where: { source: "polymarket-us", slug: match.slug },
      select: { id: true, title: true, slug: true, category: true },
    });
    if (!row?.slug) {
      MATCH_CACHE.set(cacheKey, null);
      return null;
    }
    const entry: UsCatalogEntry = {
      marketId: row.id,
      title: row.title,
      category: row.category,
      slug: row.slug,
    };
    slugIndex.set(row.slug.toLowerCase(), entry);
    const resolved: ResolvedUsMarket = {
      ...entry,
      confidence: match.confidence,
      reason: match.reason,
    };
    MATCH_CACHE.set(cacheKey, resolved);
    return resolved;
  }

  const resolved: ResolvedUsMarket = {
    ...catalog,
    confidence: match.confidence,
    reason: match.reason,
  };
  MATCH_CACHE.set(cacheKey, resolved);
  return resolved;
}

export async function fetchScanWalletTrades(wallet: string): Promise<ScanWalletTrade[]> {
  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet,
    limit: TRADE_LIMIT,
  });
  if (!res.ok || !res.data) return [];
  return res.data;
}

export type ScanNetPosition = {
  scanKey: string;
  eventSlug: string | null;
  marketQuestion: string;
  side: string;
  size: number;
  avgPrice: number;
};

export function netOpenPositionsFromScanTrades(trades: ScanWalletTrade[]): ScanNetPosition[] {
  const byKey = new Map<
    string,
    {
      scanKey: string;
      eventSlug: string | null;
      marketQuestion: string;
      side: string;
      shares: number;
      cost: number;
    }
  >();

  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );

  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const row = byKey.get(key) ?? {
      scanKey: key,
      eventSlug: t.event_slug?.trim() ?? null,
      marketQuestion: t.market_question?.trim() || t.market,
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
      scanKey: r.scanKey,
      eventSlug: r.eventSlug,
      marketQuestion: r.marketQuestion,
      side: r.side,
      size: r.shares,
      avgPrice: r.shares > 0 ? r.cost / r.shares : 0,
    }));
}

export async function loadLeaderWalletsForIntel(): Promise<string[]> {
  const wallets = new Set<string>();

  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    include: { trader: { select: { address: true } } },
  });
  for (const c of controls) wallets.add(c.trader.address.toLowerCase());

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
  });
  for (const w of watchlist) wallets.add(w.wallet.toLowerCase());

  return [...wallets];
}
