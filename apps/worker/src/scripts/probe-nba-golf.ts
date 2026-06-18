import { PolymarketUS } from "polymarket-us";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";

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

const titles = ["Spurs vs. Knicks", "Spurs vs Knicks", "PGA Championship", "Bryson DeChambeau", "Will the Fed cut rates"];
for (const t of titles) {
  const s = await client.search.query({ query: t.split(" ")[0], limit: 50, status: "active" });
  let best = 0;
  let us = "";
  for (const ev of s.events ?? [])
    for (const m of ev.markets ?? []) {
      const ut = m.title ?? m.question ?? "";
      const sc = score(t, ut);
      if (sc > best) {
        best = sc;
        us = ut;
      }
    }
  console.log({ t, best, us: us.slice(0, 90) });
}
