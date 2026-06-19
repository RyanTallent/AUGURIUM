import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  fetchUsPortfolioTradePage,
  resolveUsTraderWallet,
} from "../lib/us-portfolio-trades.js";
import { fetchUsSeedLeaderTrades } from "../lib/us-seed-leader-trades.js";
import { ensureUsMarketForSlug } from "./sync-positions-us.js";

const STREAM = "polymarket-us:trades:ingest";
const ACTIVITY_PAGES = Number(process.env.US_TRADE_INGEST_ACTIVITY_PAGES ?? "3");
const SEED_SCAN_ENABLED = process.env.COPY_US_SEED_SCAN_INTEL !== "false";

function tradeExternalKey(tradeId: string, wallet: string, slug: string): string {
  return `us:${tradeId}:${wallet}:${slug}`;
}

async function upsertUsTrade(input: {
  wallet: string;
  tradeId: string;
  slug: string;
  title: string;
  marketId: string;
  side: string;
  size: number;
  price: number;
  tradedAt: Date;
  discoveredVia: string;
}): Promise<boolean> {
  const traderId = await upsertTraderFromWallet(input.wallet, input.discoveredVia);
  const externalKey = tradeExternalKey(input.tradeId, input.wallet, input.slug);
  const existing = await prisma.trade.findUnique({
    where: { externalKey },
    select: { id: true },
  });
  if (existing) return false;

  try {
    await prisma.trade.create({
      data: {
        externalKey,
        traderId,
        marketId: input.marketId,
        conditionId: input.slug,
        transactionHash: input.tradeId,
        asset: input.slug,
        side: input.side,
        outcome: input.title,
        slug: input.slug,
        size: input.size,
        price: input.price,
        tradedAt: input.tradedAt,
        source: "polymarket-us",
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function ingestPortfolioActivities(): Promise<number> {
  let wallet: string;
  try {
    wallet = resolveUsTraderWallet();
  } catch (err) {
    console.warn(
      `[us-trade-ingest] portfolio skip: ${err instanceof Error ? err.message : err}`,
    );
    return 0;
  }

  let ingested = 0;
  let cursor: string | undefined;
  for (let page = 0; page < ACTIVITY_PAGES; page++) {
    const batch = await fetchUsPortfolioTradePage({ limit: 50, cursor });
    await storeRawPayload("polymarket-us", `portfolio/activities:${page}`, batch);

    for (const t of batch.trades) {
      const marketId = await ensureUsMarketForSlug(t.marketSlug, t.marketSlug);
      const added = await upsertUsTrade({
        wallet,
        tradeId: t.tradeId,
        slug: t.marketSlug,
        title: t.marketSlug,
        marketId,
        side: t.side,
        size: t.quantity,
        price: t.price,
        tradedAt: t.tradedAt,
        discoveredVia: "polymarket-us-portfolio",
      });
      if (added) ingested++;
    }

    if (batch.eof || !batch.nextCursor) break;
    cursor = batch.nextCursor;
  }

  console.log(`[us-trade-ingest] portfolio wallet=${wallet.slice(0, 10)}… ingested=${ingested}`);
  return ingested;
}

async function ingestSeedLeaderTrades(): Promise<number> {
  if (!SEED_SCAN_ENABLED) {
    console.log("[us-trade-ingest] seed scan intel disabled (COPY_US_SEED_SCAN_INTEL=false)");
    return 0;
  }

  const rows = await fetchUsSeedLeaderTrades();
  let ingested = 0;
  for (const row of rows) {
    const added = await upsertUsTrade({
      wallet: row.wallet,
      tradeId: row.tradeId,
      slug: row.slug,
      title: row.title,
      marketId: row.marketId,
      side: row.side,
      size: row.size,
      price: row.price,
      tradedAt: row.tradedAt,
      discoveredVia: "polymarket-us-seed-scan",
    });
    if (added) ingested++;
  }

  console.log(`[us-trade-ingest] seed/watchlist scan rows=${rows.length} ingested=${ingested}`);
  return ingested;
}

export async function ingestUsTrades(): Promise<number> {
  await getOrCreateCursor(STREAM, "portfolio");
  await markCursorRunning(STREAM);

  const portfolioIngested = await ingestPortfolioActivities();
  const seedIngested = await ingestSeedLeaderTrades();
  const ingested = portfolioIngested + seedIngested;

  await advanceCursor(STREAM, "portfolio", {
    ingested,
    portfolioIngested,
    seedIngested,
    seedScanEnabled: SEED_SCAN_ENABLED,
  } as Prisma.InputJsonValue);

  console.log(`[us-trade-ingest] total ingested=${ingested}`);
  return ingested;
}
