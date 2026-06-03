import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  dataPositionsUrl,
  fetchJson,
  positionExternalKey,
  type DataApiPosition,
} from "../lib/polymarket.js";
import { ensureMarketForPosition } from "../lib/market-linking.js";
import { storeRawPayload } from "../lib/ingestion-store.js";

const TRADERS_PER_RUN = Number(process.env.POSITION_SYNC_BATCH_SIZE ?? "10");

export async function syncPositionsFromApi(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket-positions-api", status: "running" },
  });

  let synced = 0;
  let marketsLinked = 0;
  const linkMethods: Record<string, number> = {};

  try {
    const traders = await prisma.trader.findMany({
      orderBy: { updatedAt: "asc" },
      take: TRADERS_PER_RUN,
    });

    for (const trader of traders) {
      const url = dataPositionsUrl(trader.address);
      const positions = await fetchJson<DataApiPosition[]>(url);
      await storeRawPayload("polymarket-data-api", url, positions);

      for (const pos of positions) {
        const { marketId, method } = await ensureMarketForPosition(pos);
        linkMethods[method] = (linkMethods[method] ?? 0) + 1;
        marketsLinked++;

        const side = pos.outcome ?? "UNKNOWN";
        const key = positionExternalKey(trader.address, pos.conditionId, pos.asset);
        const status = pos.size > 0.0001 ? "open" : "closed";

        await prisma.position.upsert({
          where: { externalKey: key },
          create: {
            externalKey: key,
            traderId: trader.id,
            marketId,
            conditionId: pos.conditionId,
            asset: pos.asset,
            side,
            size: pos.size,
            avgPrice: pos.avgPrice,
            pnl: pos.cashPnl ?? 0,
            source: "api",
            status,
            syncedAt: new Date(),
            closedAt: status === "closed" ? new Date() : null,
          },
          update: {
            marketId,
            size: pos.size,
            avgPrice: pos.avgPrice,
            pnl: pos.cashPnl ?? 0,
            status,
            syncedAt: new Date(),
            closedAt: status === "closed" ? new Date() : null,
          },
        });

        synced++;
      }
    }

    const metadata: Prisma.InputJsonValue = {
      positionsSynced: synced,
      marketsLinked,
      linkMethods,
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: synced,
        metadata,
        finishedAt: new Date(),
      },
    });

    console.log(
      `[sync-positions] synced=${synced} marketLinks=${marketsLinked}`,
      linkMethods,
    );
    return synced;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
