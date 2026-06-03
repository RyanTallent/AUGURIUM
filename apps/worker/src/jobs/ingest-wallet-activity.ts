import { prisma } from "@augurium/database";
import { SYNC_STREAMS } from "@augurium/shared";
import {
  dataActivityUrl,
  fetchJson,
  normalizeAddress,
  tradeExternalKey,
  type DataApiActivity,
} from "../lib/polymarket.js";
import {
  handlePaginationExhausted,
  isPaginationExhaustedError,
} from "../lib/ingest-pagination.js";
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
} from "../lib/ingestion-store.js";

const WALLETS_PER_RUN = Number(process.env.WALLET_ACTIVITY_BATCH_SIZE ?? "5");
const PAGE_SIZE = Number(process.env.WALLET_ACTIVITY_PAGE_SIZE ?? "50");
const MAX_PAGES_PER_WALLET = Number(process.env.WALLET_ACTIVITY_MAX_PAGES ?? "3");

export async function ingestWalletActivity(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket-wallet-activity", status: "running" },
  });

  let totalIngested = 0;

  try {
    const traders = await prisma.trader.findMany({
      orderBy: { lastActivityAt: "asc" },
      take: WALLETS_PER_RUN,
    });

    for (const trader of traders) {
      const stream = SYNC_STREAMS.walletActivity(trader.address);
      await getOrCreateCursor(stream, "offset");
      await markCursorRunning(stream);

      const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream } });
      let offset = Number.parseInt(cursor.cursorValue, 10) || 0;
      let walletIngested = 0;

      try {
        for (let page = 0; page < MAX_PAGES_PER_WALLET; page++) {
          const url = dataActivityUrl(trader.address, PAGE_SIZE, offset);
          let activities: DataApiActivity[];
          try {
            activities = await fetchJson<DataApiActivity[]>(url, { offset });
          } catch (err) {
            if (isPaginationExhaustedError(err)) {
              await handlePaginationExhausted(stream, err);
              break;
            }
            throw err;
          }
          const rawId = await storeRawPayload("polymarket-data-api", url, activities);

          if (activities.length === 0) {
            await advanceCursor(stream, "0", { complete: true });
            break;
          }

          for (const row of activities) {
            if (row.type !== "TRADE") continue;

            const wallet = normalizeAddress(row.proxyWallet);
            const externalKey = tradeExternalKey(
              row.transactionHash,
              row.asset,
              wallet,
            );

            const exists = await prisma.trade.findUnique({
              where: { externalKey },
              select: { id: true },
            });
            if (exists) continue;

            const link = await resolveOrCreateMarket(hintsFromDataTrade(row));

            await prisma.trade.create({
              data: {
                externalKey,
                traderId: trader.id,
                marketId: link?.marketId ?? null,
                conditionId: row.conditionId,
                transactionHash: row.transactionHash,
                asset: row.asset,
                side: row.side,
                outcome: row.outcome,
                slug: row.slug,
                eventSlug: row.eventSlug,
                size: row.size,
                price: row.price,
                tradedAt: new Date(row.timestamp * 1000),
                source: "wallet-activity",
                rawPayloadId: rawId,
              },
            });

            walletIngested++;
            totalIngested++;
          }

          offset += PAGE_SIZE;
          await advanceCursor(stream, String(offset), {
            lastPageSize: activities.length,
          });

          if (activities.length < PAGE_SIZE) {
            await advanceCursor(stream, "0", { complete: true });
            break;
          }
        }

        await prisma.trader.update({
          where: { id: trader.id },
          data: {
            lastActivityAt: new Date(),
            trades: { increment: walletIngested },
          },
        });
      } catch (walletErr) {
        const message =
          walletErr instanceof Error ? walletErr.message : "unknown error";
        await failCursor(stream, message);
        console.warn(`[wallet-activity] failed for ${trader.address}:`, message);
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

    console.log(`[wallet-activity] ingested ${totalIngested} trades`);
    return totalIngested;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
