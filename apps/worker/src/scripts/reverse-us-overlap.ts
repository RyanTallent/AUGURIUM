import { PolymarketUS } from "polymarket-us";
import { mapToSpecialtyBucket } from "@augurium/shared";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";
import { polymarketScanFetch } from "../lib/polymarket-scan.js";

const MIN = 0.9;
const client = new PolymarketUS({
  apiBaseUrl: "https://api.polymarket.us",
  gatewayBaseUrl: "https://gateway.polymarket.us",
});

function conf(a: string, b: string) {
  if (!usMarketTitlesMatch(a, b)) return 0;
  const e = a.trim().toLowerCase().replace(/\s+/g, " ");
  const ac = b.trim().toLowerCase().replace(/\s+/g, " ");
  if (e === ac) return 1;
  const tokens = e
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2);
  const matched = tokens.filter((t) => ac.includes(t)).length;
  return Math.min(0.99, 0.6 + (matched / tokens.length) * 0.35);
}

async function usActiveMarkets(queries: string[]) {
  const rows: Array<{ title: string; slug: string; bucket: string }> = [];
  for (const q of queries) {
    const search = await client.search.query({ query: q, limit: 80, status: "active" });
    for (const ev of search.events ?? [])
      for (const m of ev.markets ?? []) {
        if (!m.slug || m.closed || m.active === false) continue;
        const title = m.title ?? m.question ?? "";
        if (!title) continue;
        rows.push({
          title,
          slug: m.slug,
          bucket: mapToSpecialtyBucket({ title, slug: m.slug }),
        });
      }
  }
  return rows;
}

async function main() {
  const usMarkets = await usActiveMarkets(["mlb", "nba", "golf", "pga", "politics", "econ", "tech", "nfl"]);
  const exactUs = usMarkets.filter((m) => m.title.includes(" vs. ") || m.title.includes(" vs "));
  console.log(`US active markets=${usMarkets.length} vs-style=${exactUs.length}`);

  const whales = await polymarketScanFetch<
    Array<{ wallet: string; market_title: string; market_slug?: string }>
  >("whales", { limit: 200 });

  const byWalletTitle = new Map<string, { wallet: string; title: string }>();
  for (const row of whales.data ?? []) {
    if (!row.wallet || !row.market_title) continue;
    const key = `${row.wallet.toLowerCase()}:${row.market_title}`;
    byWalletTitle.set(key, { wallet: row.wallet.toLowerCase(), title: row.market_title });
  }

  type Hit = {
    wallet: string;
    scanTitle: string;
    usTitle: string;
    usSlug: string;
    bucket: string;
    confidence: number;
  };
  const hits: Hit[] = [];

  for (const [, row] of byWalletTitle) {
    for (const us of exactUs) {
      const c = conf(row.title, us.title);
      if (c >= MIN) {
        hits.push({
          wallet: row.wallet,
          scanTitle: row.title,
          usTitle: us.title,
          usSlug: us.slug,
          bucket: mapToSpecialtyBucket({ title: row.title, slug: row.market_slug }),
          confidence: c,
        });
      }
    }
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  const uniqueWallets = [...new Set(hits.map((h) => h.wallet))];
  console.log(`wallets with >=${MIN} hits=${uniqueWallets.length}`);

  for (const wallet of uniqueWallets.slice(0, 12)) {
    const walletHits = hits.filter((h) => h.wallet === wallet);
    const pnl = await polymarketScanFetch<{ summary?: Record<string, unknown> }>("wallet_pnl", { wallet });
    const s = pnl.data?.summary as {
      roi_percent?: number;
      win_rate?: number;
      trade_count?: number;
      total_pnl?: number;
    } | undefined;
    console.log(
      JSON.stringify({
        wallet,
        bestHit: walletHits[0],
        roi: s?.roi_percent,
        winRate: s?.win_rate,
        trades: s?.trade_count,
        pnl: s?.total_pnl,
      }),
    );
  }
}

main();
