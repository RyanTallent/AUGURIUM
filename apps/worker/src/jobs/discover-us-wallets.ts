import { prisma } from "@augurium/database";
import { upsertTraderFromWallet } from "../lib/ingestion-store.js";

const BATCH = Number(process.env.US_WALLET_DISCOVER_BATCH ?? "200");

function parseSeedWallets(): string[] {
  const raw = process.env.COPY_US_SEED_WALLETS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^0x[a-f0-9]{40}$/.test(w));
}

/** Discover wallets from US trades + optional seed list — no manual Render shell required. */
export async function discoverUsWallets(): Promise<number> {
  let discovered = 0;

  for (const wallet of parseSeedWallets()) {
    const before = await prisma.trader.findUnique({
      where: { address: wallet },
      select: { discoveredVia: true },
    });
    await upsertTraderFromWallet(wallet, "polymarket-us-seed");
    if (!before || before.discoveredVia !== "polymarket-us-seed") discovered++;
  }

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
    take: 12,
  });
  for (const row of watchlist) {
    const wallet = row.wallet.toLowerCase();
    const before = await prisma.trader.findUnique({
      where: { address: wallet },
      select: { discoveredVia: true },
    });
    await upsertTraderFromWallet(wallet, "us-admin-watchlist");
    if (!before || before.discoveredVia !== "us-admin-watchlist") discovered++;
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await prisma.trade.findMany({
    where: {
      source: "polymarket-us",
      tradedAt: { gte: since },
    },
    orderBy: { tradedAt: "desc" },
    take: BATCH,
    select: { traderId: true, trader: { select: { address: true, discoveredVia: true } } },
    distinct: ["traderId"],
  });

  for (const row of rows) {
    const address = row.trader.address;
    const before = row.trader.discoveredVia;
    const via =
      before === "polymarket-scan-us-intel" || before === "us-admin-watchlist"
        ? before
        : "polymarket-scan-us-intel";
    await upsertTraderFromWallet(address, via);
    if (before !== via) discovered++;
  }

  console.log(
    `[us-wallet-discover] batch=${rows.length} seeds=${parseSeedWallets().length} watchlist=${watchlist.length} newlyTagged=${discovered}`,
  );
  return discovered;
}
