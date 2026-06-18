import { prisma } from "@augurium/database";
import { syncPositionsFromPolymarketScanForTrader } from "@augurium/copy-trading";
import {
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  polymarketScanFetch,
  type ScanWalletTrade,
} from "../lib/polymarket-scan.js";

const TRADE_LIMIT = Number(process.env.POLYMARKET_SCAN_TRADES_LIMIT ?? "200");
const COPY_BATCH = Number(process.env.POSITION_SYNC_COPY_BATCH ?? "8");
const GATE_SYNC_BATCH = Number(process.env.COPY_US_GATE_REFRESH_LIMIT ?? "12");
const SYNC_BATCH = Math.max(COPY_BATCH, GATE_SYNC_BATCH);

export { syncPositionsFromPolymarketScanForTrader };

/** Sync open leader positions from PolymarketScan wallet_trades for COPY-enabled traders. */
export async function syncPositionsFromPolymarketScan(opts?: {
  fastOnly?: boolean;
}): Promise<number> {
  const fastOnly = opts?.fastOnly === true;
  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: { evaluatedAt: "desc" },
    take: SYNC_BATCH,
    include: { trader: true },
  });

  const traderById = new Map<string, { id: string; address: string }>();
  for (const c of controls) {
    traderById.set(c.trader.id, c.trader);
  }

  if (!fastOnly) {
    const scanLeaders = await prisma.trader.findMany({
      where: { discoveredVia: "polymarket-scan", lastScoredAt: { not: null } },
      orderBy: { rankingScore: "desc" },
      take: SYNC_BATCH,
      select: { id: true, address: true },
    });
    for (const t of scanLeaders) {
      traderById.set(t.id, t);
    }
  }

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    take: SYNC_BATCH,
  });

  console.log(
    `[position-sync:scan] mode=${fastOnly ? "fast" : "slow"} leaders=${traderById.size} watchlist=${watchlist.length}`,
  );

  let synced = 0;
  let index = 0;
  const total = traderById.size;
  for (const trader of traderById.values()) {
    index++;
    try {
      const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
        wallet: trader.address,
        limit: TRADE_LIMIT,
      });
      await storeRawPayload(
        "polymarket-scan",
        `wallet_trades?wallet=${trader.address}`,
        res,
      );
      const n = await syncPositionsFromPolymarketScanForTrader(trader);
      synced += n;
      console.log(`[position-sync:scan] progress ${index}/${total}`);
    } catch (err) {
      console.warn(
        `[position-sync:scan] trader ${trader.address.slice(0, 10)}… failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const w of watchlist) {
    try {
      const traderId = await upsertTraderFromWallet(w.wallet, "polymarket-scan-watchlist");
      synced += await syncPositionsFromPolymarketScanForTrader({
        id: traderId,
        address: w.wallet,
      });
    } catch (err) {
      console.warn(
        `[position-sync:scan] watchlist ${w.wallet.slice(0, 10)}… failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (traderById.size > 0 || watchlist.length > 0) {
    console.log(
      `[position-sync:scan] done total=${synced} positions for ${traderById.size} leader(s) + ${watchlist.length} watchlist`,
    );
  }
  return synced;
}
