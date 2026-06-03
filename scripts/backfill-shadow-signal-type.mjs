#!/usr/bin/env node
/** Backfill ShadowTrade.signalType from linked Signal. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const missing = await prisma.shadowTrade.findMany({
    where: { OR: [{ signalType: "" }, { signalType: "RESEARCH" }] },
    include: { signal: { select: { signalType: true } } },
    take: 5000,
  });

  let updated = 0;
  for (const row of missing) {
    const type = row.signal.signalType;
    if (type && type !== row.signalType) {
      await prisma.shadowTrade.update({
        where: { id: row.id },
        data: { signalType: type },
      });
      updated++;
    }
  }
  console.log(`Backfilled signalType on ${updated} shadow trades`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
