import { prisma } from "@augurium/database";
import { positionExternalKey } from "../lib/polymarket.js";
import { resolveOrCreateMarket } from "../lib/market-linking.js";

const TRADERS_PER_RUN = Number(process.env.POSITION_RECONSTRUCT_BATCH_SIZE ?? "10");

interface LedgerRow {
  conditionId: string;
  asset: string;
  outcome: string;
  side: string;
  size: number;
  price: number;
  tradedAt: Date;
}

function applyTrade(
  ledger: Map<string, LedgerRow>,
  trade: {
    conditionId: string;
    asset: string;
    outcome: string | null;
    side: string;
    size: number;
    price: number;
    tradedAt: Date;
  },
): void {
  const outcome = trade.outcome ?? "UNKNOWN";
  const key = `${trade.conditionId}:${trade.asset}:${outcome}`;
  const existing = ledger.get(key);

  const signedSize = trade.side === "BUY" ? trade.size : -trade.size;

  if (!existing) {
    if (signedSize <= 0) return;
    ledger.set(key, {
      conditionId: trade.conditionId,
      asset: trade.asset,
      outcome,
      side: outcome,
      size: signedSize,
      price: trade.price,
      tradedAt: trade.tradedAt,
    });
    return;
  }

  const newSize = existing.size + signedSize;
  if (newSize <= 0.0001) {
    ledger.delete(key);
    return;
  }

  const totalCost = existing.size * existing.price + Math.abs(signedSize) * trade.price;
  ledger.set(key, {
    ...existing,
    size: newSize,
    price: totalCost / newSize,
    tradedAt: trade.tradedAt,
  });
}

export async function reconstructPositionsFromTrades(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "position-reconstruct-trades", status: "running" },
  });

  let reconstructed = 0;

  try {
    const traders = await prisma.trader.findMany({
      where: { trades: { gt: 0 } },
      orderBy: { updatedAt: "asc" },
      take: TRADERS_PER_RUN,
    });

    for (const trader of traders) {
      const tradeRows = await prisma.trade.findMany({
        where: { traderId: trader.id },
        orderBy: { tradedAt: "asc" },
      });

      const ledger = new Map<string, LedgerRow>();
      for (const t of tradeRows) {
        applyTrade(ledger, t);
      }

      for (const row of ledger.values()) {
        const link = await resolveOrCreateMarket({
          conditionId: row.conditionId,
          asset: row.asset,
        });
        if (!link) continue;

        const key = positionExternalKey(trader.address, row.conditionId, row.asset);

        await prisma.position.upsert({
          where: { externalKey: key },
          create: {
            externalKey: key,
            traderId: trader.id,
            marketId: link.marketId,
            conditionId: row.conditionId,
            asset: row.asset,
            side: row.side,
            size: row.size,
            avgPrice: row.price,
            source: "reconstructed",
            status: "open",
            openedAt: row.tradedAt,
            syncedAt: new Date(),
          },
          update: {
            size: row.size,
            avgPrice: row.price,
            source: "reconstructed",
            status: "open",
            syncedAt: new Date(),
          },
        });

        reconstructed++;
      }
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: reconstructed,
        finishedAt: new Date(),
      },
    });

    console.log(`[reconstruct-positions] ${reconstructed} positions updated`);
    return reconstructed;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
