import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  fetchJson,
  gammaEventsUrl,
  gammaMarketsUrl,
  type GammaEvent,
  type GammaMarket,
  type GammaMarketRecord,
} from "../lib/polymarket.js";
import { upsertMarketFromGamma } from "../lib/market-linking.js";
import {
  advanceCursor,
  failCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
} from "../lib/ingestion-store.js";

const PAGE_SIZE = Number(process.env.INGEST_MARKETS_PAGE_SIZE ?? "50");
const MAX_PAGES_ACTIVE = Number(process.env.INGEST_MARKETS_MAX_PAGES_ACTIVE ?? "10");
const MAX_PAGES_CLOSED = Number(process.env.INGEST_MARKETS_MAX_PAGES_CLOSED ?? "6");
const MAX_PAGES_EVENTS = Number(process.env.INGEST_MARKETS_MAX_PAGES_EVENTS ?? "4");

const STREAM_ACTIVE = "polymarket:markets:active";
const STREAM_CLOSED = "polymarket:markets:closed";
const STREAM_EVENTS = "polymarket:markets:events";

async function ingestMarketsPages(
  stream: string,
  buildUrl: (limit: number, offset: number) => string,
  maxPages: number,
): Promise<number> {
  await getOrCreateCursor(stream, "offset");
  await markCursorRunning(stream);

  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream } });
  let offset = Number.parseInt(cursor.cursorValue, 10) || 0;
  let count = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = buildUrl(PAGE_SIZE, offset);
    const markets = await fetchJson<GammaMarketRecord[]>(url);
    await storeRawPayload("polymarket-gamma", url, markets);

    if (markets.length === 0) {
      await advanceCursor(stream, "0", { resetReason: "end-of-feed" });
      break;
    }

    for (const market of markets) {
      if (!market.conditionId) continue;
      await upsertMarketFromGamma(market);
      count++;
    }

    offset += PAGE_SIZE;
    await advanceCursor(stream, String(offset), { lastPageSize: markets.length });

    if (markets.length < PAGE_SIZE) {
      await advanceCursor(stream, "0", { resetReason: "partial-page" });
      break;
    }
  }

  return count;
}

async function upsertGammaEventMarket(
  event: GammaEvent,
  market: GammaMarket,
): Promise<void> {
  await upsertMarketFromGamma(
    {
      ...market,
      question: market.question ?? event.title,
      events: [{ id: event.id, slug: event.slug }],
    },
    { eventId: event.id, eventSlug: event.slug },
  );
}

async function ingestEventPages(): Promise<number> {
  await getOrCreateCursor(STREAM_EVENTS, "offset");
  await markCursorRunning(STREAM_EVENTS);

  const cursor = await prisma.syncCursor.findUniqueOrThrow({
    where: { stream: STREAM_EVENTS },
  });
  let offset = Number.parseInt(cursor.cursorValue, 10) || 0;
  let count = 0;

  for (let page = 0; page < MAX_PAGES_EVENTS; page++) {
    const url = gammaEventsUrl(PAGE_SIZE, offset, true);
    const events = await fetchJson<GammaEvent[]>(url);
    await storeRawPayload("polymarket-gamma", url, events);

    if (events.length === 0) {
      await advanceCursor(STREAM_EVENTS, "0", { resetReason: "end-of-feed" });
      break;
    }

    for (const event of events) {
      if (event.markets?.length) {
        for (const market of event.markets) {
          if (!market.conditionId) continue;
          await upsertGammaEventMarket(event, market);
          count++;
        }
      }
    }

    offset += PAGE_SIZE;
    await advanceCursor(STREAM_EVENTS, String(offset), {
      lastPageSize: events.length,
    });

    if (events.length < PAGE_SIZE) {
      await advanceCursor(STREAM_EVENTS, "0", { resetReason: "partial-page" });
      break;
    }
  }

  return count;
}

export async function ingestPolymarketMarkets(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket-markets", status: "running" },
  });

  try {
    const activeCount = await ingestMarketsPages(
      STREAM_ACTIVE,
      (limit, offset) => gammaMarketsUrl(limit, offset, { active: true, closed: false }),
      MAX_PAGES_ACTIVE,
    );

    const closedCount = await ingestMarketsPages(
      STREAM_CLOSED,
      (limit, offset) => gammaMarketsUrl(limit, offset, { closed: true }),
      MAX_PAGES_CLOSED,
    );

    const eventCount = await ingestEventPages();

    const total = activeCount + closedCount + eventCount;
    const metadata: Prisma.InputJsonValue = {
      activeMarkets: activeCount,
      closedMarkets: closedCount,
      eventMarkets: eventCount,
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: total,
        metadata,
        finishedAt: new Date(),
      },
    });

    console.log(
      `[ingest-markets] synced ${total} rows (active=${activeCount}, closed=${closedCount}, events=${eventCount})`,
    );
    return total;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await failCursor(STREAM_ACTIVE, message);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
