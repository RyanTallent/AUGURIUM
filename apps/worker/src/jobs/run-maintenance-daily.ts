import { prisma, runDailyMaintenance } from "@augurium/database";
import { normalizeMarketCategory } from "@augurium/scoring";
import { captureWorkerMemory } from "../lib/worker-memory.js";

const CATEGORY_BATCH = Number(process.env.DAILY_CATEGORY_BACKFILL_BATCH ?? "500");

async function backfillCategoriesBatch(): Promise<number> {
  let updated = 0;
  let cursor: string | undefined;

  const markets = await prisma.market.findMany({
    take: CATEGORY_BATCH,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
    select: { id: true, category: true, title: true, slug: true, eventSlug: true },
  });

  for (const m of markets) {
    const normalized = normalizeMarketCategory({
      gammaCategory: m.category,
      title: m.title,
      slug: m.slug,
      eventSlug: m.eventSlug,
    });
    if (normalized !== m.category) {
      await prisma.market.update({
        where: { id: m.id },
        data: { category: normalized },
      });
      updated++;
    }
  }

  return updated;
}

export async function runMaintenanceDailyJob(): Promise<Record<string, unknown>> {
  const mem = captureWorkerMemory();
  console.log("[maintenance:daily] starting", mem);

  const categoriesUpdated = await backfillCategoriesBatch();
  const result = await runDailyMaintenance(false);

  if (result.runId) {
    const existing = await prisma.ingestionRun.findUnique({
      where: { id: result.runId },
      select: { metadata: true },
    });
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    await prisma.ingestionRun.update({
      where: { id: result.runId },
      data: {
        metadata: {
          ...meta,
          workerMemory: mem,
          categoriesUpdated,
        } as object,
      },
    });
  }

  console.log("[maintenance:daily] done", {
    status: result.status,
    categoriesUpdated,
    impossiblePnl: result.after.impossiblePnlCount,
    liveTradingReady: result.after.liveTradingReady,
  });

  return {
    status: result.status,
    dryRun: false,
    categoriesUpdated,
    categoriesBatch: CATEGORY_BATCH,
    impossiblePnlBefore: result.before.impossiblePnlCount,
    impossiblePnlAfter: result.after.impossiblePnlCount,
    liveTradingReady: result.after.liveTradingReady,
    reportPath: result.reportWritten,
    workerMemory: mem,
  };
}
