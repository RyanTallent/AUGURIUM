import { PolymarketUS } from "polymarket-us";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";
import { polymarketScanFetch } from "../lib/polymarket-scan.js";

function score(a: string, b: string) {
  if (!usMarketTitlesMatch(a, b)) return 0;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return 1;
  const e = a.trim().toLowerCase();
  const ac = b.trim().toLowerCase();
  const tokens = e
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2);
  const matched = tokens.filter((t) => ac.includes(t)).length;
  return Math.min(0.99, 0.6 + (matched / tokens.length) * 0.35);
}

const client = new PolymarketUS({
  apiBaseUrl: "https://api.polymarket.us",
  gatewayBaseUrl: "https://gateway.polymarket.us",
});

async function bestMatch(title: string) {
  const q = title.slice(0, 24).replace(/[^\w\s]/g, " ");
  const search = await client.search.query({ query: q, limit: 40, status: "active" });
  let best = 0;
  let us = "";
  for (const ev of search.events ?? [])
    for (const m of ev.markets ?? []) {
      const ut = m.title ?? m.question ?? "";
      const s = score(title, ut);
      if (s > best) {
        best = s;
        us = ut;
      }
    }
  return { best, us };
}

async function main() {
  const titles = [
    "Toronto Blue Jays vs. Boston Red Sox",
    "Baltimore Orioles vs. Seattle Mariners",
    "Israel x Hezbollah permanent peace deal by June 15, 2026?",
    "US x Iran diplomatic meeting by June 15, 2026?",
    "Will Keiko Fujimori win the 2026 Peruvian presidential election?",
    "Will the price of Bitcoin be above $58,000 on June 18?",
    "Strait of Hormuz traffic returns to normal by end of June?",
  ];
  for (const t of titles) {
    console.log(t, "=>", await bestMatch(t));
  }

  console.log("\nleaderboard:");
  const lb = await polymarketScanFetch<Array<{ wallet?: string; market_title?: string }>>("leaderboard");
  console.log("ok", lb.ok, "rows", lb.data?.length ?? 0);
  if (lb.data?.length) {
    for (const row of lb.data.slice(0, 15)) {
      if (!row.wallet || !row.market_title) continue;
      const m = await bestMatch(row.market_title);
      if (m.best >= 0.9) console.log({ wallet: row.wallet, title: row.market_title, ...m });
    }
  }
}

main();
