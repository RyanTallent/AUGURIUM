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
import { seedUsLeaderWatchlistWallet } from "@augurium/copy-trading";

const DEFAULT_SEEDS: Array<{ wallet: string; notes: string }> = [
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
    const result = await seedUsLeaderWatchlistWallet({
      wallet: seed.wallet,
      notes: seed.notes,
    });
    console.log(
      `[seed] watchlist ${result.wallet.slice(0, 10)}… metrics=${result.metricsFound} synced=${result.positionsSynced} usMatch=${(result.usMatchConfidence * 100).toFixed(0)}% gates=${result.leaderGatesPass ? "pass" : "fail"}`,
    );
    if (result.gateReasons.length > 0) {
      console.log(`[seed] gate reasons: ${result.gateReasons.join("; ")}`);
    }
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
