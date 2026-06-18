import { PolymarketUS } from "polymarket-us";
import { mapToSpecialtyBucket } from "@augurium/shared";
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";
import { polymarketScanFetch } from "../lib/polymarket-scan.js";

const MIN = 0.9;

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
  for (const q of [
    "mlb",
    "nba",
    "nfl",
    "nhl",
    "golf",
    "pga",
    "world cup",
    "politics",
    "econ",
    "tech",
    "tennis",
    "ufc",
  ]) {
    const search = await client.search.query({ query: q, limit: 100, status: "active" });
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
  const cat = await catalog();
  const whales = await polymarketScanFetch<Array<{ wallet: string; market_title: string; market_slug?: string }>>(
    "whales",
    { limit: 150 },
  );

  const hits: Array<{ wallet: string; title: string; bucket: string; best: number; us: string; slug: string }> = [];
  const seen = new Set<string>();

  for (const row of whales.data ?? []) {
    const key = `${row.wallet}:${row.market_title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = row.market_title;
    let best = 0;
    let us = "";
    let slug = "";
    for (const c of cat) {
      const s = conf(title, c.title);
      if (s > best) {
        best = s;
        us = c.title;
        slug = c.slug;
      }
    }
    if (best >= MIN) {
      hits.push({
        wallet: row.wallet.toLowerCase(),
        title,
        bucket: mapToSpecialtyBucket({ title, slug: row.market_slug }),
        best,
        us,
        slug,
      });
    }
  }

  hits.sort((a, b) => b.best - a.best);
  console.log(`hits >= ${MIN}:`, hits.length);
  for (const h of hits.slice(0, 25)) {
    console.log(JSON.stringify(h));
  }

  // Also probe known COPY leader
  const leader = "0xa8b9d28f2846f087c4855ff4ad20de5e7f98775d";
  const trades = await polymarketScanFetch<Array<{ market_question: string; event_slug?: string }>>(
    "wallet_trades",
    { wallet: leader, limit: 40 },
  );
  console.log("\nleader trades sample:");
  for (const t of (trades.data ?? []).slice(0, 8)) {
    let best = 0;
    let us = "";
    for (const c of cat) {
      const s = conf(t.market_question, c.title);
      if (s > best) {
        best = s;
        us = c.title;
      }
    }
    console.log({ title: t.market_question.slice(0, 70), best, us: us.slice(0, 70) });
  }
}

main();
