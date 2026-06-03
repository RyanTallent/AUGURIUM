import { prisma } from "@augurium/database";
import type { TapePoint } from "@augurium/scoring";

/** Build price tapes per conditionId:asset from all ingested trades (for copyability / edge). */
export async function buildMarketTapesForKeys(
  keys: Set<string>,
): Promise<Map<string, TapePoint[]>> {
  const tapes = new Map<string, TapePoint[]>();
  if (keys.size === 0) return tapes;

  const pairs = [...keys].map((k) => {
    const [conditionId, asset] = k.split(":");
    return { conditionId, asset };
  });

  const conditionIds = [...new Set(pairs.map((p) => p.conditionId))];

  const rows = await prisma.trade.findMany({
    where: { conditionId: { in: conditionIds } },
    select: { conditionId: true, asset: true, price: true, tradedAt: true },
    orderBy: { tradedAt: "asc" },
  });

  for (const row of rows) {
    const key = `${row.conditionId}:${row.asset}`;
    if (!keys.has(key)) continue;
    const list = tapes.get(key) ?? [];
    list.push({ tradedAt: row.tradedAt, price: row.price });
    tapes.set(key, list);
  }

  return tapes;
}
