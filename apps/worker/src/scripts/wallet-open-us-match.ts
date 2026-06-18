import { PolymarketUS } from "polymarket-us";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";
import { polymarketScanFetch, type ScanWalletTrade } from "../lib/polymarket-scan.js";

const wallet = process.argv[2] ?? "0x89dd49bf87c41be422927372a0b75c6ab577f662";
const client = new PolymarketUS({
  apiBaseUrl: "https://api.polymarket.us",
  gatewayBaseUrl: "https://gateway.polymarket.us",
});

function score(a: string, b: string) {
  if (!usMarketTitlesMatch(a, b)) return 0;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return 1;
  const e = a.trim().toLowerCase();
  const ac = b.trim().toLowerCase();
  const tokens = e.split(/\s+/).map((t) => t.replace(/[^a-z0-9.+-]/g, "")).filter((t) => t.length > 2);
  return Math.min(0.99, 0.6 + (tokens.filter((t) => ac.includes(t)).length / tokens.length) * 0.35);
}

async function catalog() {
  const by = new Map<string, string>();
  for (const q of ["mlb", "nba", "golf", "politics"]) {
    const s = await client.search.query({ query: q, limit: 100, status: "active" });
    for (const ev of s.events ?? [])
      for (const m of ev.markets ?? []) {
        const t = m.title ?? m.question ?? "";
        if (m.slug && t && !m.closed && m.active !== false) by.set(m.slug, t);
      }
  }
  return by;
}

function netOpen(trades: ScanWalletTrade[]) {
  const by = new Map<string, { shares: number; title: string }>();
  for (const t of [...trades].sort((a, b) => +new Date(a.trade_timestamp) - +new Date(b.trade_timestamp))) {
    const key = `${t.market}:${t.outcome}`;
    const row = by.get(key) ?? { shares: 0, title: t.market_question };
    row.shares += t.side === "SELL" ? -t.size : t.size;
    by.set(key, row);
  }
  return [...by.values()].filter((r) => r.shares > 0.01);
}

const cat = await catalog();
const trades = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", { wallet, limit: 120 });
const opens = netOpen(trades.data ?? []);
console.log("open positions", opens.length);
for (const pos of opens) {
  let best = 0;
  let us = "";
  for (const t of cat.values()) {
    const s = score(pos.title, t);
    if (s > best) {
      best = s;
      us = t;
    }
  }
  console.log({ title: pos.title, shares: pos.shares, usMatch: best, us: us.slice(0, 80) });
}
