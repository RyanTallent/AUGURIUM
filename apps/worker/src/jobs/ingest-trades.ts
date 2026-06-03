import { prisma } from "@augurium/database";
import { SYNC_STREAMS } from "@augurium/shared";
import {
  dataTradesUrl,
  fetchJson,
  normalizeAddress,
  tradeExternalKey,
  type DataApiTrade,
} from "../lib/polymarket.js";
import {
  hintsFromDataTrade,
  resolveOrCreateMarket,
} from "../lib/market-linking.js";
import {
  advanceCursor,
  failCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";

const PAGE_SIZE = Number(process.env.INGEST_TRADES_PAGE_SIZE ?? "100");
const MAX_PAGES = Number(process.env.INGEST_TRADES_MAX_PAGES ?? "5");

export async function ingestGlobalTrades(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket-trades-global", status: "running" },
  });

  const stream = SYNC_STREAMS.GLOBAL_TRADES;
  await getOrCreateCursor(stream, "offset");
  await markCursorRunning(stream);

  let totalIngested = 0;

  try {
    const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream } });
    let offset = Number.parseInt(cursor.cursorValue, 10) || 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = dataTradesUrl(PAGE_SIZE, offset);
      const trades = await fetchJson<DataApiTrade[]>(url);
      const rawId = await storeRawPayload("polymarket-data-api", url, trades);

      if (trades.length === 0) {
        await advanceCursor(stream, "0", { resetReason: "end-of-feed" });
        break;
      }

      let pageCount = 0;

      for (const trade of trades) {
        const wallet = normalizeAddress(trade.proxyWallet);
        const externalKey = tradeExternalKey(
          trade.transactionHash,
          trade.asset,
          wallet,
        );

        const existing = await prisma.trade.findUnique({
          where: { externalKey },
          select: { id: true, marketId: true },
        });
        if (existing) {
          if (!existing.marketId) {
            const link = await resolveOrCreateMarket(hintsFromDataTrade(trade));
            if (link) {
              await prisma.trade.update({
                where: { id: existing.id },
                data: {
                  marketId: link.marketId,
                  slug: trade.slug,
                  eventSlug: trade.eventSlug,
                },
              });
            }
          }
          continue;
        }

        const traderId = await upsertTraderFromWallet(wallet, "global-trades", {
          pseudonym: trade.pseudonym,
          label: trade.name,
        });

        const link = await resolveOrCreateMarket(hintsFromDataTrade(trade));

        try {
          await prisma.trade.create({
            data: {
              externalKey,
              traderId,
              marketId: link?.marketId ?? null,
              conditionId: trade.conditionId,
              transactionHash: trade.transactionHash,
              asset: trade.asset,
              side: trade.side,
              outcome: trade.outcome,
              slug: trade.slug,
              eventSlug: trade.eventSlug,
              size: trade.size,
              price: trade.price,
              tradedAt: new Date(trade.timestamp * 1000),
              source: "global-trades",
              rawPayloadId: rawId,
            },
          });
        } catch (createErr) {
          if (
            createErr &&
            typeof createErr === "object" &&
            "code" in createErr &&
            createErr.code === "P2002"
          ) {
            continue;
          }
          throw createErr;
        }

        await prisma.trader.update({
          where: { id: traderId },
          data: { trades: { increment: 1 } },
        });

        pageCount++;
        totalIngested++;
      }

      offset += PAGE_SIZE;
      await advanceCursor(stream, String(offset), {
        lastPageSize: trades.length,
        lastPageIngested: pageCount,
      });

      if (trades.length < PAGE_SIZE) {
        await advanceCursor(stream, "0", { resetReason: "partial-page" });
        break;
      }
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: totalIngested,
        finishedAt: new Date(),
      },
    });

    console.log(`[ingest-trades] ingested ${totalIngested} new trades`);
    return totalIngested;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await failCursor(stream, message);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
