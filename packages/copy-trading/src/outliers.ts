import { prisma } from "@augurium/database";

export interface OutlierOpportunity {
  id: string;
  label: "OUTLIER OPPORTUNITY";
  marketId: string;
  marketTitle: string;
  reason: string;
  signalType: string | null;
  disagreementScore: number;
  triggerNotional: number;
  eliteTraderCount: number;
  autoTrade: false;
}

export async function detectOutlierOpportunities(
  eliteMinScore = 75,
  limit = 25,
): Promise<OutlierOpportunity[]> {
  const elite = await prisma.trader.findMany({
    where: { rankingScore: { gte: eliteMinScore }, lastScoredAt: { not: null } },
    select: { address: true },
    take: 200,
  });
  const eliteSet = new Set(elite.map((e) => e.address.toLowerCase()));

  const signals = await prisma.signal.findMany({
    where: { status: "active", signalType: { in: ["TRADE_NOW", "WATCHLIST", "RESEARCH"] } },
    include: { market: { select: { id: true, title: true, category: true } } },
    orderBy: { disagreementScore: "desc" },
    take: 80,
  });

  const outliers: OutlierOpportunity[] = [];

  for (const s of signals) {
    const wallets = s.triggerTraderWallets.map((w) => w.toLowerCase());
    const eliteHits = wallets.filter((w) => eliteSet.has(w));
    const reasons: string[] = [];

    if (s.disagreementScore >= 0.4 && eliteHits.length >= 2) {
      reasons.push("elite trader disagreement");
    }
    if (s.triggerNotional >= 25_000) {
      reasons.push("abnormal volume / notional");
    }
    if (s.alphaScore >= 0.75 && s.marketQualityScore < 0.45) {
      reasons.push("high alpha vs low market quality (mispricing signal)");
    }
    if (s.copyabilityScore >= 0.5 && s.triggerNotional >= 10_000) {
      reasons.push("large copyable bet");
    }

    if (reasons.length === 0) continue;

    outliers.push({
      id: s.id,
      label: "OUTLIER OPPORTUNITY",
      marketId: s.marketId,
      marketTitle: s.market.title,
      reason: reasons.join("; "),
      signalType: s.signalType,
      disagreementScore: s.disagreementScore,
      triggerNotional: s.triggerNotional,
      eliteTraderCount: eliteHits.length,
      autoTrade: false,
    });
    if (outliers.length >= limit) break;
  }

  return outliers;
}
