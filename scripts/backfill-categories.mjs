#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { normalizeMarketCategory } from "@augurium/scoring";

const prisma = new PrismaClient();
const BATCH = Number(process.env.CATEGORY_BACKFILL_BATCH ?? "500");

async function main() {
  let updated = 0;
  let cursor = undefined;

  for (;;) {
    const markets = await prisma.market.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, category: true, title: true, slug: true, eventSlug: true },
    });
    if (!markets.length) break;

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

    cursor = markets[markets.length - 1].id;
    if (markets.length < BATCH) break;
  }

  console.log(JSON.stringify({ updated, batchSize: BATCH }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
