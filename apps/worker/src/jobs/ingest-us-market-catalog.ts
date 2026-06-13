import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import { getPolymarketUsPublicClient } from "@augurium/execution";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
} from "../lib/ingestion-store.js";

const STREAM = "polymarket-us:markets:catalog";
const SEARCH_QUERIES = (
  process.env.US_MARKET_CATALOG_QUERIES ??
  "mlb,nba,nfl,nhl,soccer,esports,valorant,cs2,dota,politics"
).split(",");
const MARKETS_PER_QUERY = Number(process.env.US_MARKET_CATALOG_LIMIT_PER_QUERY ?? "40");

function readMarketTitle(market: {
  title?: string;
  question?: string;
}): string {
  return market.title ?? market.question ?? "";
}

export async function ingestUsMarketCatalog(): Promise<number> {
  await getOrCreateCursor(STREAM, "query-index");
  await markCursorRunning(STREAM);

  const client = getPolymarketUsPublicClient();
  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM } });
  const queryIndex = Number.parseInt(cursor.cursorValue, 10) || 0;
  const query = SEARCH_QUERIES[queryIndex % SEARCH_QUERIES.length]?.trim();
  if (!query) {
    await advanceCursor(STREAM, "0", { resetReason: "no-queries" });
    return 0;
  }

  let upserted = 0;
  try {
    const search = await client.search.query({
      query,
      limit: MARKETS_PER_QUERY,
      status: "active",
    });
    await storeRawPayload("polymarket-us", `search?query=${query}`, search);

    for (const event of search.events ?? []) {
      for (const market of event.markets ?? []) {
        if (!market.slug || market.closed || !market.active) continue;
        const title = readMarketTitle(market);
        if (!title) continue;

        const externalId = `us:${market.slug}`;
        await prisma.market.upsert({
          where: { externalId },
          create: {
            externalId,
            source: "polymarket-us",
            title,
            slug: market.slug,
            category: (event as { category?: string }).category ?? undefined,
            eventSlug: event.slug ?? null,
            active: true,
            closed: false,
            acceptingOrders: true,
          },
          update: {
            title,
            slug: market.slug,
            category: (event as { category?: string }).category ?? undefined,
            eventSlug: event.slug ?? undefined,
            active: true,
            closed: false,
            acceptingOrders: true,
          },
        });
        upserted++;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[us-market-catalog] search failed query=${query}: ${message}`);
  }

  const nextIndex = (queryIndex + 1) % SEARCH_QUERIES.length;
  await advanceCursor(STREAM, String(nextIndex), {
    lastQuery: query,
    upserted,
  } as Prisma.InputJsonValue);

  console.log(`[us-market-catalog] query=${query} upserted=${upserted} nextIndex=${nextIndex}`);
  return upserted;
}
