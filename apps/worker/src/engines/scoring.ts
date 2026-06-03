import { prisma } from "@augurium/database";

/** Placeholder scoring engine — ranks traders by ROI until real cluster analysis lands. */
export async function scoreTraders(): Promise<number> {
  const traders = await prisma.trader.findMany({ take: 100 });

  for (const trader of traders) {
    const normalized = Math.min(100, Math.max(0, 50 + trader.roi * 10));
    await prisma.trader.update({
      where: { id: trader.id },
      data: { score: normalized },
    });
  }

  console.log(`[scoring] updated ${traders.length} traders`);
  return traders.length;
}
