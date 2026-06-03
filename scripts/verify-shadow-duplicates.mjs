#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const open = await prisma.shadowTrade.findMany({
    where: { status: "OPEN" },
    select: { id: true, marketId: true, side: true, signalType: true },
  });

  const groups = new Map();
  for (const r of open) {
    const key = `${r.marketId}|${r.side}|${r.signalType}`;
    const list = groups.get(key) ?? [];
    list.push(r.id);
    groups.set(key, list);
  }

  const dups = [...groups.entries()].filter(([, ids]) => ids.length > 1);
  console.log("=== Shadow duplicate audit ===");
  console.log(`Open shadows: ${open.length}`);
  console.log(`Duplicate active groups: ${dups.length}`);

  for (const [key, ids] of dups.slice(0, 20)) {
    console.log(`  ${key} → ${ids.length} positions: ${ids.join(", ")}`);
  }

  if (dups.length > 0) {
    console.error("FAIL: duplicate active shadow positions detected");
    process.exit(1);
  }
  console.log("PASS: no duplicate active marketId+side+signalType groups");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
