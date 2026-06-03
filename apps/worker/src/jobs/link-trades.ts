import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import { backfillTradeMarketLinks } from "../lib/market-linking.js";

export async function linkTradesToMarkets(): Promise<number> {
  const beforeUnlinked = await prisma.trade.count({ where: { marketId: null } });

  const run = await prisma.ingestionRun.create({
    data: { source: "trade-market-link", status: "running" },
  });

  try {
    const maxBatches = Number(process.env.TRADE_LINK_MAX_BATCHES ?? "20");
    const batchSize = Number(process.env.TRADE_LINK_BATCH_SIZE ?? "500");
    const merged = {
      examined: 0,
      linked: 0,
      unlinked: 0,
      byMethod: {} as Record<string, number>,
      unlinkedReasons: {} as Record<string, number>,
    };

    for (let batch = 0; batch < maxBatches; batch++) {
      const stats = await backfillTradeMarketLinks(batchSize);
      merged.examined += stats.examined;
      merged.linked += stats.linked;
      merged.unlinked += stats.unlinked;
      for (const [k, v] of Object.entries(stats.byMethod)) {
        merged.byMethod[k] = (merged.byMethod[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(stats.unlinkedReasons)) {
        merged.unlinkedReasons[k] = (merged.unlinkedReasons[k] ?? 0) + v;
      }
      if (stats.examined === 0) break;
    }

    const stats = merged;
    const afterUnlinked = await prisma.trade.count({ where: { marketId: null } });

    const metadata: Prisma.InputJsonValue = {
      ...stats,
      beforeUnlinked,
      afterUnlinked,
      linkedPct:
        stats.examined > 0
          ? Math.round((stats.linked / stats.examined) * 10000) / 100
          : 100,
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: stats.linked,
        metadata,
        finishedAt: new Date(),
      },
    });

    console.log(
      `[link-trades] examined=${stats.examined} linked=${stats.linked} unlinked=${stats.unlinked} before=${beforeUnlinked} after=${afterUnlinked}`,
    );
    console.log(`[link-trades] methods`, stats.byMethod);
    if (stats.unlinked > 0) {
      console.log(`[link-trades] unlinked reasons`, stats.unlinkedReasons);
    }

    return stats.linked;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
