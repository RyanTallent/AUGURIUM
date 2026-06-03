#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.market.count();
  const categorized = await prisma.market.count({
    where: {
      AND: [
        { category: { not: null } },
        { category: { notIn: ["", "Other", "uncategorized"] } },
      ],
    },
  });
  const byCategory = await prisma.market.groupBy({
    by: ["category"],
    _count: true,
    orderBy: { _count: { category: "desc" } },
    take: 15,
  });

  const pct = total > 0 ? (categorized / total) * 100 : 0;
  const report = {
    passed: pct >= 25,
    totalMarkets: total,
    categorizedMarkets: categorized,
    categorizedPct: Number(pct.toFixed(1)),
    topCategories: byCategory.map((c) => ({
      category: c.category ?? "null",
      count: c._count,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
