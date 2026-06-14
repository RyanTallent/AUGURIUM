import { prisma } from "@augurium/database";
import { evaluateUsCompatibilityGate } from "@augurium/execution";
import { isUsOnlyLiveCopyMode } from "@augurium/shared";
import { polymarketScanFetch, type ScanWalletTrade } from "./polymarket-scan.js";

const GLOBAL_ONLY_PATTERNS = [
  /\bhighest temperature\b/i,
  /\btemperature in\b/i,
  /\btemperature be\b/i,
  /\btemperature between\b/i,
  /\b\d+°[cf]\b/i,
  /\b\d+°c\b/i,
  /\b\d+°f\b/i,
  /\bbetween \d+.+\d+°/i,
];

export function isLikelyGlobalOnlyMarketTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return GLOBAL_ONLY_PATTERNS.some((p) => p.test(t));
}

export function usLeaderCompatRequired(): boolean {
  return (
    isUsOnlyLiveCopyMode() &&
    process.env.COPY_US_REQUIRE_COMPAT_POSITION !== "false"
  );
}

function netOpenTitlesFromTrades(trades: ScanWalletTrade[]): Array<{
  marketId: string;
  title: string;
  slug: string | null;
}> {
  const byKey = new Map<string, { shares: number; title: string; slug: string | null }>();
  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );

  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const row = byKey.get(key) ?? {
      shares: 0,
      title: t.market_question,
      slug: t.event_slug ?? null,
    };
    const signed = t.side === "SELL" ? -t.size : t.size;
    row.shares += signed;
    byKey.set(key, row);
  }

  return [...byKey.entries()]
    .filter(([, row]) => row.shares > 0.01)
    .map(([key, row]) => ({
      marketId: key.split(":")[0] ?? key,
      title: row.title,
      slug: row.slug,
    }));
}

export interface UsLeaderCompatScore {
  openPositions: number;
  likelyGlobalOnly: number;
  usCompatible: number;
  bestConfidence: number;
  hasTradeableUsPosition: boolean;
}

/** Score a leader's open positions for Polymarket US live copy. */
export async function scoreTraderUsLiveCompat(
  traderId: string,
  address: string,
): Promise<UsLeaderCompatScore> {
  const dbPositions = await prisma.position.findMany({
    where: { traderId, status: "open" },
    include: { market: { select: { id: true, title: true, slug: true, category: true } } },
    take: 25,
  });

  let candidates: Array<{
    marketId: string;
    title: string;
    slug: string | null;
    category: string | null;
  }>;

  if (dbPositions.length > 0) {
    candidates = dbPositions.map((p) => ({
      marketId: p.marketId,
      title: p.market.title,
      slug: p.market.slug,
      category: p.market.category,
    }));
  } else {
    const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
      wallet: address,
      limit: 80,
    });
    candidates = netOpenTitlesFromTrades(res.data ?? []).map((p) => ({
      marketId: p.marketId,
      title: p.title,
      slug: p.slug,
      category: null,
    }));
  }

  let likelyGlobalOnly = 0;
  let usCompatible = 0;
  let bestConfidence = 0;

  for (const pos of candidates) {
    if (isLikelyGlobalOnlyMarketTitle(pos.title)) {
      likelyGlobalOnly++;
      continue;
    }
    const gate = await evaluateUsCompatibilityGate({
      globalMarketId: pos.marketId,
      globalTitle: pos.title,
      globalSlug: pos.slug,
      side: "yes",
      category: pos.category,
    });
    bestConfidence = Math.max(bestConfidence, gate.confidence);
    if (gate.allowed && gate.usMarketSlug) usCompatible++;
  }

  return {
    openPositions: candidates.length,
    likelyGlobalOnly,
    usCompatible,
    bestConfidence,
    hasTradeableUsPosition: usCompatible > 0,
  };
}
