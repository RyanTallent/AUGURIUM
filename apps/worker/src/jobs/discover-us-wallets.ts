import { prisma } from "@augurium/database";
import { upsertTraderFromWallet } from "../lib/ingestion-store.js";

const BATCH = Number(process.env.US_WALLET_DISCOVER_BATCH ?? "200");

/** Discover wallets from ingested Polymarket US trade rows — no manual seeds required. */
export async function discoverUsWallets(): Promise<number> {
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

  let discovered = 0;
  for (const row of rows) {
    const address = row.trader.address;
    const before = row.trader.discoveredVia;
    await upsertTraderFromWallet(address, "polymarket-us-trades");
    if (before !== "polymarket-us-trades") discovered++;
  }

  console.log(`[us-wallet-discover] batch=${rows.length} newlyTagged=${discovered}`);
  return discovered;
}
