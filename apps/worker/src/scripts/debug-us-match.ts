import { PolymarketUS } from "polymarket-us";
import { mapToSpecialtyBucket } from "@augurium/shared";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";
import { polymarketScanFetch } from "../lib/polymarket-scan.js";

function norm(t: string) {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}
function conf(a: string, b: string) {
  if (!usMarketTitlesMatch(a, b)) return 0;
  const e = norm(a);
  const ac = norm(b);
  if (e === ac) return 1;
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

async function catalog() {
  const bySlug = new Map<string, { slug: string; title: string }>();
  for (const q of ["mlb", "golf", "world cup", "politics"]) {
    const search = await client.search.query({ query: q, limit: 80, status: "active" });
    for (const ev of search.events ?? [])
      for (const m of ev.markets ?? []) {
        if (!m.slug || m.closed || m.active === false) continue;
        const title = m.title ?? m.question ?? "";
        if (title) bySlug.set(m.slug, { slug: m.slug, title });
      }
  }
  return [...bySlug.values()];
}

async function main() {
  const whales = await polymarketScanFetch<Array<{ wallet: string; market_title: string }>>("whales", {
    limit: 30,
  });
  const cat = await catalog();
  console.log("catalog", cat.length);
  for (const row of whales.data ?? []) {
    const title = row.market_title;
    const bucket = mapToSpecialtyBucket({ title });
    let best = 0;
    let us = "";
    for (const c of cat) {
      const s = conf(title, c.title);
      if (s > best) {
        best = s;
        us = c.title;
      }
    }
    if (best >= 0.5) console.log({ wallet: row.wallet.slice(0, 12), bucket, title: title.slice(0, 60), best, us: us.slice(0, 60) });
  }
}

main();
