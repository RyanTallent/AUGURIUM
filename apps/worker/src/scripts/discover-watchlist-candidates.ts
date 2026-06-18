/**
 * Discover PolymarketScan wallets with verified US catalog overlap (≥0.90).
 *
 * Usage (from apps/worker, needs DATABASE_URL with US catalog):
 *   npx tsx src/scripts/discover-watchlist-candidates.ts
 */
import { evaluateUsCatalogMatch } from "@augurium/execution";
import { getUsCompatMinConfidence, mapToSpecialtyBucket, type SpecialtyBucket } from "@augurium/shared";
import {
  polymarketScanFetch,
  type ScanWalletPnlSummary,
  type ScanWalletTrade,
  type ScanWhaleRow,
} from "../lib/polymarket-scan.js";

const PREFERRED: SpecialtyBucket[] = ["Politics", "Sports", "Econ", "Tech", "Weather"];
const MIN_CONF = getUsCompatMinConfidence();
const EXCLUDE = new Set(
  (process.env.COPY_WATCHLIST_EXCLUDE ?? "0xa8b9d28f2846f087c4855ff4ad20de5e7f98775d")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
);

type Candidate = {
  wallet: string;
  category: string;
  roi: number;
  winRate: number;
  tradeCount: number;
  matchingMarket: string;
  usTitle: string;
  usMatchConfidence: number;
  hasOpenPosition: boolean;
  openPositionTitle: string | null;
  reason: string;
  score: number;
};

function netOpenTitles(trades: ScanWalletTrade[]): Array<{ title: string; slug: string | null; bucket: string }> {
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
    const signed = t.side === "SELL" ? -t.size : t.size;
    row.shares += signed;
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .filter((r) => r.shares > 0.01)
    .map((r) => ({ title: r.title, slug: r.slug, bucket: r.bucket }));
}

async function main(): Promise<void> {
  console.log(`[discover] US match floor=${MIN_CONF} preferred=${PREFERRED.join(", ")}`);

  const whalesRes = await polymarketScanFetch<ScanWhaleRow[]>("whales", { limit: 150 });
  const leaderboardRes = await polymarketScanFetch<
    Array<{ wallet?: string; market_title?: string; market_category?: string }>
  >("leaderboard");

  const titleByWallet = new Map<string, { title: string; category?: string }>();
  for (const row of whalesRes.data ?? []) {
    if (!row.wallet || !row.market_title) continue;
    const w = row.wallet.toLowerCase();
    if (!titleByWallet.has(w)) {
      titleByWallet.set(w, { title: row.market_title, category: row.market_category });
    }
  }
  for (const row of leaderboardRes.data ?? []) {
    if (!row.wallet || !row.market_title) continue;
    const w = row.wallet.toLowerCase();
    if (!titleByWallet.has(w)) {
      titleByWallet.set(w, { title: row.market_title, category: row.market_category });
    }
  }

  console.log(`[discover] unique wallets from scan=${titleByWallet.size}`);

  const overlapWallets: Array<{
    wallet: string;
    title: string;
    bucket: string;
    confidence: number;
    usTitle: string;
    usSlug: string;
  }> = [];

  for (const [wallet, meta] of titleByWallet) {
    if (EXCLUDE.has(wallet)) continue;
    const gate = await evaluateUsCatalogMatch({
      globalMarketId: wallet,
      globalTitle: meta.title,
      globalSlug: null,
      side: "yes",
      category: meta.category ?? null,
    });
    if (!gate.allowed || gate.confidence < MIN_CONF || !gate.usMarketSlug) continue;
    const bucket = mapToSpecialtyBucket({ title: meta.title });
    if (!PREFERRED.includes(bucket as SpecialtyBucket)) continue;
    overlapWallets.push({
      wallet,
      title: meta.title,
      bucket,
      confidence: gate.confidence,
      usTitle: gate.usMarketSlug,
      usSlug: gate.usMarketSlug,
    });
  }

  overlapWallets.sort((a, b) => b.confidence - a.confidence);
  console.log(`[discover] preferred-category US overlap wallets=${overlapWallets.length}`);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const row of overlapWallets) {
    if (seen.has(row.wallet)) continue;
    seen.add(row.wallet);

    const pnlRes = await polymarketScanFetch<{ summary?: ScanWalletPnlSummary | null }>("wallet_pnl", {
      wallet: row.wallet,
    });
    const summary = pnlRes.data?.summary;
    const roi = Number(summary?.roi ?? summary?.roi_percent ?? 0);
    const winRate = Number(summary?.win_rate ?? 0);
    const tradeCount = Math.floor(Number(summary?.trade_count ?? 0));

    if (tradeCount < 30) continue;
    if (winRate < 0.5 && roi <= 0) continue;

    const tradesRes = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
      wallet: row.wallet,
      limit: 120,
    });
    const opens = netOpenTitles(tradesRes.data ?? []);

    let bestOpen: { title: string; confidence: number; usSlug: string | null } | null = null;
    for (const pos of opens.slice(0, 8)) {
      const gate = await evaluateUsCatalogMatch({
        globalMarketId: pos.title,
        globalTitle: pos.title,
        globalSlug: pos.slug,
        side: "yes",
        category: pos.bucket,
      });
      if (gate.allowed && gate.confidence >= MIN_CONF) {
        if (!bestOpen || gate.confidence > bestOpen.confidence) {
          bestOpen = { title: pos.title, confidence: gate.confidence, usSlug: gate.usMarketSlug };
        }
      }
    }

    const hasOpen = bestOpen !== null;
    const score =
      row.confidence * 100 +
      (hasOpen ? 25 : 0) +
      winRate * 30 +
      Math.min(20, roi * 100) +
      Math.min(15, tradeCount / 20);

    const reasonParts = [
      `${(row.confidence * 100).toFixed(0)}% US catalog match on ${row.bucket}`,
      `${tradeCount} trades`,
      `${(winRate * 100).toFixed(0)}% win rate`,
      `${(roi * 100).toFixed(1)}% ROI`,
      hasOpen ? "has open US-tradeable position" : "recent US-overlap activity (no open ≥90% pos right now)",
    ];

    candidates.push({
      wallet: row.wallet,
      category: row.bucket,
      roi,
      winRate,
      tradeCount,
      matchingMarket: row.title,
      usTitle: row.usSlug,
      usMatchConfidence: row.confidence,
      hasOpenPosition: hasOpen,
      openPositionTitle: bestOpen?.title ?? null,
      reason: reasonParts.join("; "),
      score,
    });

    if (candidates.length >= 25) break;
  }

  candidates.sort((a, b) => b.score - a.score);

  const withOpen = candidates.filter((c) => c.hasOpenPosition);
  const picks = (withOpen.length >= 3 ? withOpen : candidates).slice(0, 5);

  console.log("\n=== TOP WATCHLIST CANDIDATES ===\n");
  for (const c of picks) {
    console.log(JSON.stringify(c, null, 2));
    console.log("---");
  }

  if (picks.length === 0) {
    console.log("[discover] No candidates passed filters. Try widening scan limit or check DATABASE_URL US catalog.");
  } else {
    const top3 = picks.slice(0, 3);
    const wallets = top3.map((c) => c.wallet).join(",");
    const notes = top3.map((c) => `${c.category.toLowerCase()} — ${(c.usMatchConfidence * 100).toFixed(0)}% US`).join("|");
    console.log("\n=== SEED COMMAND ===\n");
    console.log(
      `COPY_SEED_WATCHLIST_WALLETS="${wallets}" COPY_SEED_WATCHLIST_NOTES="${notes}" npx tsx src/scripts/seed-us-leader-watchlist.ts`,
    );
  }
}

main().catch((err) => {
  console.error("[discover] failed", err);
  process.exitCode = 1;
});
