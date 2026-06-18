/**
 * Seed UsLeaderWatchlist with US-overlap candidate wallets.
 *
 * Usage:
 *   COPY_SEED_WATCHLIST_WALLETS=0xabc...,0xdef... npx tsx src/scripts/seed-us-leader-watchlist.ts
 *
 * Optional category notes via COPY_SEED_WATCHLIST_NOTES (pipe-separated, same order):
 *   politics|sports|economics
 */
import { prisma } from "@augurium/database";
import { ingestWatchlistWalletFromScan } from "../lib/seed-watchlist-ingest.js";
import { syncPositionsFromPolymarketScanForTrader } from "../jobs/sync-positions-polymarket-scan.js";

const DEFAULT_SEEDS: Array<{ wallet: string; notes: string }> = [
  // Keep existing promoted leader if known — replace with full address from DB/brain channel.
  // { wallet: "0xa8b9...", notes: "politics — existing COPY leader (US overlap)" },
  {
    wallet: "",
    notes: "politics — set COPY_SEED_WATCHLIST_WALLETS env with PolymarketScan wallet",
  },
  {
    wallet: "",
    notes: "sports — set COPY_SEED_WATCHLIST_WALLETS env with PolymarketScan wallet",
  },
  {
    wallet: "",
    notes: "economics — set COPY_SEED_WATCHLIST_WALLETS env with PolymarketScan wallet",
  },
];

function parseEnvSeeds(): Array<{ wallet: string; notes: string }> {
  const raw = process.env.COPY_SEED_WATCHLIST_WALLETS?.trim();
  if (!raw) return [];

  const wallets = raw.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const notesRaw = process.env.COPY_SEED_WATCHLIST_NOTES?.trim();
  const notes = notesRaw ? notesRaw.split("|").map((n) => n.trim()) : [];

  return wallets.map((wallet, i) => ({
    wallet,
    notes: notes[i] ?? "manual watchlist seed",
  }));
}

async function main(): Promise<void> {
  const seeds = [...parseEnvSeeds(), ...DEFAULT_SEEDS].filter((s) => /^0x[a-f0-9]{40}$/i.test(s.wallet));

  if (seeds.length === 0) {
    console.log(
      "[seed] No valid wallets. Set COPY_SEED_WATCHLIST_WALLETS=0x...,0x... (comma-separated 0x addresses).",
    );
    console.log(
      "[seed] Find US-overlap wallets via PolymarketScan whales/leaderboard titles that match US catalog ≥90%.",
    );
    return;
  }

  for (const seed of seeds) {
    const row = await prisma.usLeaderWatchlist.upsert({
      where: { wallet: seed.wallet },
      create: { wallet: seed.wallet, enabled: true, notes: seed.notes },
      update: { enabled: true, notes: seed.notes },
    });
    console.log(`[seed] watchlist ${row.wallet.slice(0, 10)}… — ${row.notes ?? "no notes"}`);

    const traderId = await ingestWatchlistWalletFromScan(seed.wallet);
    const trader = await prisma.trader.findUnique({
      where: { id: traderId },
      select: { address: true, trades: true, winRate: true, roi: true },
    });
    console.log(
      `[seed] scan metrics trader=${trader?.address.slice(0, 10)}… trades=${trader?.trades} wr=${((trader?.winRate ?? 0) * 100).toFixed(0)}% roi=${((trader?.roi ?? 0) * 100).toFixed(1)}%`,
    );

    const synced = await syncPositionsFromPolymarketScanForTrader({
      id: traderId,
      address: seed.wallet,
    });
    console.log(`[seed] position sync synced=${synced} for ${seed.wallet.slice(0, 10)}…`);
  }

  const total = await prisma.usLeaderWatchlist.count({ where: { enabled: true } });
  console.log(`[seed] enabled watchlist entries: ${total}`);
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
