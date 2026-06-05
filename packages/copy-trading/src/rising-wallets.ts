import { prisma } from "@augurium/database";

export interface RisingWalletHit {
  address: string;
  traderId: string;
  tradeCount7d: number;
  volume7d: number;
  rankingScore: number;
}

/** Wallets with a burst of recent activity — candidates for fast scoring. */
export async function detectRisingWallets(limit = 15): Promise<RisingWalletHit[]> {
  const minTrades = Number(process.env.COPY_RISING_MIN_TRADES_7D ?? "8");
  const rows = await prisma.traderMetricsSnapshot.findMany({
    where: { tradeCount7d: { gte: minTrades } },
    orderBy: [{ tradeCount7d: "desc" }, { volume7d: "desc" }],
    take: limit * 3,
    include: { trader: { select: { id: true, address: true, rankingScore: true, lastScoredAt: true } } },
  });

  const seen = new Set<string>();
  const out: RisingWalletHit[] = [];
  for (const r of rows) {
    if (seen.has(r.traderId)) continue;
    seen.add(r.traderId);
    out.push({
      address: r.trader.address,
      traderId: r.traderId,
      tradeCount7d: r.tradeCount7d,
      volume7d: r.volume7d,
      rankingScore: r.trader.rankingScore,
    });
    if (out.length >= limit) break;
  }
  return out;
}
