/**
 * Discover watchlist candidates without DATABASE_URL.
 * Uses PolymarketScan + Polymarket US public search with same title-match rules.
 *
 *   npx tsx src/scripts/discover-watchlist-candidates-public.ts
 */
import { PolymarketUS } from "polymarket-us";
import { getUsCompatMinConfidence, mapToSpecialtyBucket, type SpecialtyBucket } from "@augurium/shared";
import {
  polymarketScanFetch,
  type ScanWalletPnlSummary,
  type ScanWalletTrade,
  type ScanWhaleRow,
} from "../lib/polymarket-scan.js";

// Reuse execution title matcher (no Prisma).
import { usMarketTitlesMatch } from "../../../../packages/execution/src/polymarket-us-market-slug.js";

const MIN_CONF = getUsCompatMinConfidence();
const PREFERRED: SpecialtyBucket[] = ["Politics", "Sports", "Econ", "Tech", "Weather"];
const EXCLUDE = new Set(["0xa8b9d28f2846f087c4855ff4ad20de5e7f98775d"]);

type UsCatalogRow = { slug: string; title: string; category?: string };

const usClient = new PolymarketUS({
  apiBaseUrl: process.env.POLYMARKET_US_API_BASE ?? "https://api.polymarket.us",
  gatewayBaseUrl: process.env.POLYMARKET_US_GATEWAY_BASE ?? "https://gateway.polymarket.us",
});

const CATALOG_QUERIES = [
  "mlb",
  "nba",
  "nfl",
  "nhl",
  "golf",
  "tennis",
  "world cup",
  "politics",
  "econ",
  "tech",
  "ufc",
  "mls",
];

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleMatchConfidence(expectedTitle: string, usTitle: string): number {
  if (!usMarketTitlesMatch(expectedTitle, usTitle)) return 0;
  const expected = normalizeTitle(expectedTitle);
  const actual = normalizeTitle(usTitle);
  if (expected === actual) return 1;
  const tokens = expected
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((t) => actual.includes(t)).length;
  return Math.min(0.99, 0.6 + (matched / tokens.length) * 0.35);
}

async function buildUsCatalog(): Promise<UsCatalogRow[]> {
  const bySlug = new Map<string, UsCatalogRow>();
  for (const query of CATALOG_QUERIES) {
    try {
      const search = await usClient.search.query({ query, limit: 50, status: "active" });
      for (const event of search.events ?? []) {
        for (const market of event.markets ?? []) {
          if (!market.slug || market.closed || market.active === false) continue;
          const title = market.title ?? market.question ?? "";
          if (!title) continue;
          bySlug.set(market.slug, {
            slug: market.slug,
            title,
            category: (event as { category?: string }).category,
          });
        }
      }
    } catch (err) {
      console.warn(`[discover] US search failed query=${query}`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[discover] US catalog rows=${bySlug.size}`);
  return [...bySlug.values()];
}

function matchFromCatalog(title: string, catalog: UsCatalogRow[]): {
  slug: string | null;
  confidence: number;
  usTitle: string | null;
} {
  let best = { slug: null as string | null, confidence: 0, usTitle: null as string | null };
  for (const row of catalog) {
    const confidence = titleMatchConfidence(title, row.title);
    if (confidence > best.confidence) {
      best = { slug: row.slug, confidence, usTitle: row.title };
    }
  }
  return best;
}

function netOpenTitles(trades: ScanWalletTrade[]) {
  const byKey = new Map<string, { shares: number; title: string; slug: string | null; bucket: string }>();
  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );
  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const bucket = mapToSpecialtyBucket({ title: t.market_question, slug: t.event_slug });
    const row = byKey.get(key) ?? {
      shares: 0,
      title: t.market_question,
      slug: t.event_slug ?? null,
      bucket,
    };
    row.shares += t.side === "SELL" ? -t.size : t.size;
    byKey.set(key, row);
  }
  return [...byKey.values()].filter((r) => r.shares > 0.01);
}

type Candidate = {
  wallet: string;
  category: string;
  roi: number;
  winRate: number;
  tradeCount: number;
  matchingMarket: string;
  usTitle: string | null;
  usMatchConfidence: number;
  hasOpenPosition: boolean;
  openPositionTitle: string | null;
  reason: string;
  score: number;
};

async function main(): Promise<void> {
  const catalog = await buildUsCatalog();
  const whalesRes = await polymarketScanFetch<ScanWhaleRow[]>("whales", { limit: 150 });

  const titleByWallet = new Map<string, { title: string; slug?: string }>();
  for (const row of whalesRes.data ?? []) {
    if (!row.wallet || !row.market_title) continue;
    const w = row.wallet.toLowerCase();
    if (!titleByWallet.has(w)) {
      titleByWallet.set(w, { title: row.market_title, slug: row.market_slug });
    }
  }

  const overlap: Array<{ wallet: string; title: string; bucket: string; match: ReturnType<typeof matchFromCatalog> }> =
    [];
  for (const [wallet, meta] of titleByWallet) {
    if (EXCLUDE.has(wallet)) continue;
    const match = matchFromCatalog(meta.title, catalog);
    if (!match.slug || match.confidence < MIN_CONF) continue;
    const bucket = mapToSpecialtyBucket({ title: meta.title, slug: meta.slug });
    if (!PREFERRED.includes(bucket as SpecialtyBucket)) continue;
    overlap.push({ wallet, title: meta.title, bucket, match });
  }

  overlap.sort((a, b) => b.match.confidence - a.match.confidence);
  console.log(`[discover] preferred overlap wallets=${overlap.length}`);

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const row of overlap) {
    if (seen.has(row.wallet)) continue;
    seen.add(row.wallet);

    const pnlRes = await polymarketScanFetch<{ summary?: ScanWalletPnlSummary | null }>("wallet_pnl", {
      wallet: row.wallet,
    });
    const s = pnlRes.data?.summary;
    const roi = Number(s?.roi ?? s?.roi_percent ?? 0);
    const winRate = Number(s?.win_rate ?? 0);
    const tradeCount = Math.floor(Number(s?.trade_count ?? 0));

    // Skip brand-new whale wallets with no history
    if (tradeCount < 25 && winRate === 0 && roi === 0) continue;

    const tradesRes = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
      wallet: row.wallet,
      limit: 120,
    });
    const opens = netOpenTitles(tradesRes.data ?? []);
    let bestOpen: { title: string; confidence: number; usTitle: string | null } | null = null;
    for (const pos of opens.slice(0, 10)) {
      const m = matchFromCatalog(pos.title, catalog);
      if (m.slug && m.confidence >= MIN_CONF) {
        if (!bestOpen || m.confidence > bestOpen.confidence) {
          bestOpen = { title: pos.title, confidence: m.confidence, usTitle: m.usTitle };
        }
      }
    }

    const hasOpen = bestOpen !== null;
    const score =
      row.match.confidence * 100 +
      (hasOpen ? 30 : 0) +
      winRate * 25 +
      Math.min(20, Math.max(0, roi * 100)) +
      Math.min(15, tradeCount / 25);

    candidates.push({
      wallet: row.wallet,
      category: row.bucket,
      roi,
      winRate,
      tradeCount,
      matchingMarket: row.title,
      usTitle: row.match.usTitle,
      usMatchConfidence: row.match.confidence,
      hasOpenPosition: hasOpen,
      openPositionTitle: bestOpen?.title ?? null,
      reason: [
        `${(row.match.confidence * 100).toFixed(0)}% US match`,
        `${tradeCount} trades`,
        winRate > 0 ? `${(winRate * 100).toFixed(0)}% WR` : "WR n/a",
        roi !== 0 ? `${(roi * 100).toFixed(1)}% ROI` : "ROI n/a",
        hasOpen ? `open: ${bestOpen!.title}` : "recent overlap activity",
      ].join("; "),
      score,
    });
    if (candidates.length >= 30) break;
  }

  candidates.sort((a, b) => b.score - a.score);
  const withOpen = candidates.filter((c) => c.hasOpenPosition);
  const picks = pickDiverse((withOpen.length >= 2 ? withOpen : candidates).slice(0, 12), 3);

  console.log("\n=== RECOMMENDED WATCHLIST SEEDS ===\n");
  for (const c of picks) {
    console.log(`Wallet: ${c.wallet}`);
    console.log(`Category: ${c.category}`);
    console.log(`ROI: ${(c.roi * 100).toFixed(1)}% | Win rate: ${(c.winRate * 100).toFixed(0)}% | Trades: ${c.tradeCount}`);
    console.log(`Matching market: ${c.matchingMarket}`);
    console.log(`US match: ${(c.usMatchConfidence * 100).toFixed(0)}% → ${c.usTitle ?? "—"}`);
    console.log(`Open position: ${c.openPositionTitle ?? "none ≥90%"}`);
    console.log(`Why seed: ${c.reason}`);
    console.log("---");
  }

  if (picks.length > 0) {
    const wallets = picks.map((c) => c.wallet).join(",");
    const notes = picks.map((c) => `${c.category.toLowerCase()} — ${(c.usMatchConfidence * 100).toFixed(0)}% US`).join("|");
    console.log("\nRENDER SHELL / LOCAL SEED:\n");
    console.log(
      `COPY_SEED_WATCHLIST_WALLETS="${wallets}" COPY_SEED_WATCHLIST_NOTES="${notes}" npx tsx src/scripts/seed-us-leader-watchlist.ts`,
    );
  }
}

function pickDiverse(rows: Candidate[], n: number): Candidate[] {
  const picked: Candidate[] = [];
  const cats = new Set<string>();
  for (const row of rows) {
    if (picked.length >= n) break;
    if (cats.has(row.category) && picked.length < n - 1) continue;
    cats.add(row.category);
    picked.push(row);
  }
  if (picked.length < n) {
    for (const row of rows) {
      if (picked.length >= n) break;
      if (picked.some((p) => p.wallet === row.wallet)) continue;
      picked.push(row);
    }
  }
  return picked;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
