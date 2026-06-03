#!/usr/bin/env node
/**
 * Close duplicate OPEN shadows per marketId+side+signalType, keeping newest.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const open = await prisma.shadowTrade.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      marketId: true,
      side: true,
      signalType: true,
      createdAt: true,
    },
  });

  const groups = new Map();
  for (const row of open) {
    const key = `${row.marketId}|${row.side}|${row.signalType}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let closed = 0;
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;
    const [keep, ...dupes] = rows;
    console.log(`Group ${key}: keep ${keep.id}, close ${dupes.length}`);
    for (const d of dupes) {
      if (!DRY_RUN) {
        await prisma.shadowTrade.update({
          where: { id: d.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            latestReasoning: "Closed: duplicate active position cleanup",
            positionRemaining: 0,
            unrealizedPnl: 0,
          },
        });
      }
      closed++;
    }
  }

  console.log(DRY_RUN ? `Would close ${closed} duplicates` : `Closed ${closed} duplicates`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
