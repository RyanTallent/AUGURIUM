import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import { searchUsExchangeTrades } from "../lib/us-report-trades.js";

const STREAM = "polymarket-us:trades:ingest";
const MARKETS_PER_RUN = Number(process.env.US_TRADE_INGEST_MARKETS_PER_RUN ?? "8");
const TRADES_PER_MARKET = Number(process.env.US_TRADE_INGEST_LIMIT_PER_MARKET ?? "40");

function tradeExternalKey(tradeId: string, wallet: string, slug: string): string {
  return `us:${tradeId}:${wallet}:${slug}`;
}

async function resolveUsMarketId(slug: string): Promise<string | null> {
  const market = await prisma.market.findFirst({
    where: { OR: [{ slug }, { externalId: `us:${slug}` }], source: "polymarket-us" },
    select: { id: true },
  });
  return market?.id ?? null;
}

export async function ingestUsTrades(): Promise<number> {
  await getOrCreateCursor(STREAM, "market-offset");
  await markCursorRunning(STREAM);

  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM } });
  const offset = Number.parseInt(cursor.cursorValue, 10) || 0;

  const markets = await prisma.market.findMany({
    where: { source: "polymarket-us", active: true, closed: false, slug: { not: null } },
    orderBy: { updatedAt: "desc" },
    skip: offset,
    take: MARKETS_PER_RUN,
    select: { id: true, slug: true, title: true },
  });

  const total = await prisma.market.count({
    where: { source: "polymarket-us", active: true, closed: false, slug: { not: null } },
  });

  let ingested = 0;

  for (const market of markets) {
    const slug = market.slug?.trim();
    if (!slug) continue;

    try {
      const report = await searchUsExchangeTrades({
        symbol: slug,
        pageSize: TRADES_PER_MARKET,
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await storeRawPayload("polymarket-us-report", `trades/search:${slug}`, report);

      for (const t of report.trades) {
        const wallets = [t.aggressorAccount, t.passiveAccount].filter(Boolean) as string[];
        for (const wallet of wallets) {
          const traderId = await upsertTraderFromWallet(wallet, "polymarket-us-trades");
          const externalKey = tradeExternalKey(t.id, wallet, slug);
          const existing = await prisma.trade.findUnique({
            where: { externalKey },
            select: { id: true },
          });
          if (existing) continue;

          const marketId = market.id ?? (await resolveUsMarketId(slug));
          try {
            await prisma.trade.create({
              data: {
                externalKey,
                traderId,
                marketId,
                conditionId: slug,
                transactionHash: t.id,
                asset: slug,
                side: "BUY",
                outcome: market.title,
                slug,
                size: t.quantity,
                price: t.price,
                tradedAt: new Date(t.transactTime),
                source: "polymarket-us",
              },
            });
            ingested++;
          } catch {
            // race / duplicate
          }
        }
      }
    } catch (err) {
      console.warn(
        `[us-trade-ingest] skip slug=${slug}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const nextOffset = offset + MARKETS_PER_RUN >= total ? 0 : offset + MARKETS_PER_RUN;
  await advanceCursor(STREAM, String(nextOffset), {
    ingested,
    offset,
    nextOffset,
    totalMarkets: total,
  } as Prisma.InputJsonValue);

  console.log(`[us-trade-ingest] ingested=${ingested} offset=${offset} next=${nextOffset}`);
  return ingested;
}
