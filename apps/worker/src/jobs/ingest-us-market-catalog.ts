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
const WARM_MIN = Number(process.env.US_MARKET_CATALOG_WARM_MIN ?? "3000");
const MAX_UPSERTS = Number(process.env.US_MARKET_CATALOG_MAX_UPSERTS_PER_RUN ?? "80");
const UPSERT_CHUNK = Number(process.env.US_MARKET_CATALOG_UPSERT_CHUNK ?? "20");

function readMarketTitle(market: {
  title?: string;
  question?: string;
}): string {
  return market.title ?? market.question ?? "";
}

type CatalogRow = {
  externalId: string;
  title: string;
  slug: string;
  category?: string;
  eventSlug?: string | null;
};

async function upsertCatalogChunk(rows: CatalogRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.market.upsert({
        where: { externalId: row.externalId },
        create: {
          externalId: row.externalId,
          source: "polymarket-us",
          title: row.title,
          slug: row.slug,
          category: row.category,
          eventSlug: row.eventSlug,
          active: true,
          closed: false,
          acceptingOrders: true,
        },
        update: {
          title: row.title,
          slug: row.slug,
          category: row.category,
          eventSlug: row.eventSlug ?? undefined,
          active: true,
          closed: false,
          acceptingOrders: true,
        },
      }),
    ),
  );
  return rows.length;
}

export async function ingestUsMarketCatalog(): Promise<number> {
  await getOrCreateCursor(STREAM, "query-index");
  await markCursorRunning(STREAM);

  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM } });
  const queryIndex = Number.parseInt(cursor.cursorValue, 10) || 0;
  const query = SEARCH_QUERIES[queryIndex % SEARCH_QUERIES.length]?.trim();
  const nextIndex = (queryIndex + 1) % SEARCH_QUERIES.length;

  if (!query) {
    await advanceCursor(STREAM, "0", { resetReason: "no-queries" });
    return 0;
  }

  const warmCount = await prisma.market.count({
    where: { source: "polymarket-us", active: true },
  });
  if (warmCount >= WARM_MIN) {
    await advanceCursor(STREAM, String(nextIndex), {
      lastQuery: query,
      upserted: 0,
      warmSkip: true,
      catalogCount: warmCount,
    } as Prisma.InputJsonValue);
    console.log(
      `[us-market-catalog] warm skip catalogCount=${warmCount} nextIndex=${nextIndex}`,
    );
    return 0;
  }

  const client = getPolymarketUsPublicClient();
  let upserted = 0;

  try {
    const search = await client.search.query({
      query,
      limit: MARKETS_PER_QUERY,
      status: "active",
    });
    await storeRawPayload("polymarket-us", `search?query=${query}`, search);

    const pending: CatalogRow[] = [];
    for (const event of search.events ?? []) {
      for (const market of event.markets ?? []) {
        if (!market.slug || market.closed || !market.active) continue;
        const title = readMarketTitle(market);
        if (!title) continue;

        pending.push({
          externalId: `us:${market.slug}`,
          title,
          slug: market.slug,
          category: (event as { category?: string }).category ?? undefined,
          eventSlug: event.slug ?? null,
        });

        if (pending.length >= UPSERT_CHUNK) {
          upserted += await upsertCatalogChunk(pending.splice(0, pending.length));
          if (upserted >= MAX_UPSERTS) break;
        }
      }
      if (upserted >= MAX_UPSERTS) break;
    }

    if (upserted < MAX_UPSERTS && pending.length > 0) {
      const room = MAX_UPSERTS - upserted;
      upserted += await upsertCatalogChunk(pending.slice(0, room));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[us-market-catalog] search failed query=${query}: ${message}`);
  }

  await advanceCursor(STREAM, String(nextIndex), {
    lastQuery: query,
    upserted,
    catalogCount: warmCount + upserted,
  } as Prisma.InputJsonValue);

  console.log(`[us-market-catalog] query=${query} upserted=${upserted} nextIndex=${nextIndex}`);
  return upserted;
}
