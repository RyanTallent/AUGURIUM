import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import { getPolymarketUsPublicClient } from "@augurium/execution";
import { mapToSpecialtyBucket } from "@augurium/shared";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
} from "../lib/ingestion-store.js";

const STREAM = "polymarket-us:markets:catalog";
const PAGE_SIZE = Number(process.env.US_MARKET_CATALOG_PAGE_SIZE ?? "100");
const MAX_UPSERTS = Number(process.env.US_MARKET_CATALOG_MAX_UPSERTS_PER_RUN ?? "120");
const UPSERT_CHUNK = Number(process.env.US_MARKET_CATALOG_UPSERT_CHUNK ?? "25");

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

/** Scan ALL active Polymarket US markets — continuous paginated refresh, no category exclusions. */
export async function ingestUsMarketCatalog(): Promise<number> {
  await getOrCreateCursor(STREAM, "offset");
  await markCursorRunning(STREAM);

  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM } });
  const offset = Number.parseInt(cursor.cursorValue, 10) || 0;

  const client = getPolymarketUsPublicClient();
  let upserted = 0;

  try {
    const page = await client.markets.list({
      active: true,
      closed: false,
      limit: PAGE_SIZE,
      offset,
    });
    await storeRawPayload("polymarket-us", `markets/list?offset=${offset}`, page);

    const pending: CatalogRow[] = [];
    for (const market of page.markets ?? []) {
      if (!market.slug || market.closed || !market.active) continue;
      const title = readMarketTitle(market);
      if (!title) continue;

      pending.push({
        externalId: `us:${market.slug}`,
        title,
        slug: market.slug,
        category: mapToSpecialtyBucket({ title, slug: market.slug }),
        eventSlug: market.eventSlug ?? null,
      });

      if (pending.length >= UPSERT_CHUNK) {
        upserted += await upsertCatalogChunk(pending.splice(0, pending.length));
        if (upserted >= MAX_UPSERTS) break;
      }
    }

    if (upserted < MAX_UPSERTS && pending.length > 0) {
      const room = MAX_UPSERTS - upserted;
      upserted += await upsertCatalogChunk(pending.slice(0, room));
    }

    const pageCount = page.markets?.length ?? 0;
    const nextOffset = pageCount < PAGE_SIZE ? 0 : offset + PAGE_SIZE;

    await advanceCursor(STREAM, String(nextOffset), {
      upserted,
      offset,
      nextOffset,
      pageCount,
    } as Prisma.InputJsonValue);

    console.log(`[us-market-catalog] offset=${offset} upserted=${upserted} nextOffset=${nextOffset}`);
    return upserted;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[us-market-catalog] list failed offset=${offset}: ${message}`);
    await advanceCursor(STREAM, String(offset), { upserted: 0, error: message } as Prisma.InputJsonValue);
    return 0;
  }
}
