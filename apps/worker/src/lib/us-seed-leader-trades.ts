import { prisma } from "@augurium/database";
import { polymarketScanFetch, type ScanWalletTrade } from "@augurium/shared";

const TRADE_LIMIT = Number(process.env.US_SEED_SCAN_TRADES_LIMIT ?? "120");

function parseSeedWallets(): string[] {
  const raw = process.env.COPY_US_SEED_WALLETS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^0x[a-f0-9]{40}$/.test(w));
}

async function loadSeedAndWatchlistWallets(): Promise<string[]> {
  const wallets = new Set(parseSeedWallets());
  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
    take: 12,
  });
  for (const row of watchlist) {
    wallets.add(row.wallet.toLowerCase());
  }
  return [...wallets];
}

async function resolveUsMarketBySlug(slug: string): Promise<{ id: string; title: string } | null> {
  return prisma.market.findFirst({
    where: {
      source: "polymarket-us",
      OR: [{ slug }, { externalId: `us:${slug}` }],
    },
    select: { id: true, title: true },
  });
}

/**
 * Pull wallet_trades from PolymarketScan for seed/watchlist leaders only.
 * Maps trades onto US catalog markets by slug — no title matching or US-compat gates.
 */
export async function fetchUsSeedLeaderTrades(): Promise<
  Array<{
    wallet: string;
    marketId: string;
    slug: string;
    title: string;
    side: string;
    size: number;
    price: number;
    tradeId: string;
    tradedAt: Date;
  }>
> {
  const wallets = await loadSeedAndWatchlistWallets();
  if (wallets.length === 0) return [];

  const out: Array<{
    wallet: string;
    marketId: string;
    slug: string;
    title: string;
    side: string;
    size: number;
    price: number;
    tradeId: string;
    tradedAt: Date;
  }> = [];

  for (const wallet of wallets) {
    const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
      wallet,
      limit: TRADE_LIMIT,
    });
    if (!res.ok || !res.data?.length) continue;

    for (const t of res.data) {
      const slug = t.event_slug?.trim();
      if (!slug) continue;
      const market = await resolveUsMarketBySlug(slug);
      if (!market) continue;

      out.push({
        wallet,
        marketId: market.id,
        slug,
        title: market.title,
        side: t.side === "SELL" ? "SELL" : "BUY",
        size: t.size,
        price: t.price,
        tradeId: t.transaction_hash || `${wallet}:${t.market}:${t.trade_timestamp}`,
        tradedAt: new Date(t.trade_timestamp),
      });
    }
  }

  return out;
}
