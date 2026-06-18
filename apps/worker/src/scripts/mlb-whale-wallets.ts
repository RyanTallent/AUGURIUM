import { polymarketScanFetch } from "../lib/polymarket-scan.js";

const whales = await polymarketScanFetch<Array<{ wallet?: string; market_title?: string; market_slug?: string }>>(
  "whales",
  { limit: 200 },
);
const mlb = new Map<string, { wallet: string; titles: Set<string>; slugs: Set<string> }>();
for (const r of whales.data ?? []) {
  if (!r.wallet || !r.market_slug?.startsWith("mlb-")) continue;
  const w = r.wallet.toLowerCase();
  if (!mlb.has(w)) mlb.set(w, { wallet: w, titles: new Set(), slugs: new Set() });
  const row = mlb.get(w)!;
  if (r.market_title) row.titles.add(r.market_title);
  row.slugs.add(r.market_slug);
}
console.log("mlb wallets", mlb.size);
for (const row of [...mlb.values()].slice(0, 20)) {
  const pnl = await polymarketScanFetch<{ summary?: Record<string, unknown> }>("wallet_pnl", {
    wallet: row.wallet,
  });
  const s = pnl.data?.summary as {
    roi_percent?: number;
    win_rate?: number;
    trade_count?: number;
    total_pnl?: number;
  };
  console.log(
    JSON.stringify({
      wallet: row.wallet,
      titles: [...row.titles].slice(0, 4),
      roi: s?.roi_percent,
      wr: s?.win_rate,
      trades: s?.trade_count,
      pnl: s?.total_pnl,
    }),
  );
}
