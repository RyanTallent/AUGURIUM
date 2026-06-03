import { prisma } from "@augurium/database";

/** Placeholder signal engine — generates demo signals for top markets. */
export async function generateSignals(): Promise<number> {
  const markets = await prisma.market.findMany({
    where: { active: true },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });

  let created = 0;

  for (const market of markets) {
    const existing = await prisma.signal.findFirst({
      where: { marketId: market.id, status: "active" },
    });
    if (existing) continue;

    await prisma.signal.create({
      data: {
        marketId: market.id,
        side: "YES",
        confidence: 0.55 + Math.random() * 0.2,
        rationale: "Early consensus divergence detected (placeholder signal).",
      },
    });
    created++;
  }

  console.log(`[signals] created ${created} signals`);
  return created;
}
