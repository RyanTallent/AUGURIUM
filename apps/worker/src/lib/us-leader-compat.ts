import { prisma } from "@augurium/database";
import { evaluateUsCatalogMatch, evaluateUsCompatibilityGate } from "@augurium/execution";
import { isUsOnlyLiveCopyMode } from "@augurium/shared";
import { polymarketScanFetch, type ScanWalletTrade } from "./polymarket-scan.js";

const MAX_FULL_GATE_POSITIONS = Number(process.env.COPY_US_COMPAT_MAX_GATE_CHECKS ?? "3");
const MAX_FULL_GATE_LEADERS = Number(process.env.COPY_US_COMPAT_MAX_LEADERS ?? "15");

export function isLikelyGlobalOnlyMarketTitle(_title: string): boolean {
  return false;
}

export function isLikelyUsOverlapMarketTitle(_title: string): boolean {
  return true;
}

/** Pre-filter positions/leaders through US catalog gate (default on for US live copy). */
export function usLeaderCompatRequired(): boolean {
  if (process.env.COPY_US_REQUIRE_COMPAT_POSITION === "true") return isUsOnlyLiveCopyMode();
  if (process.env.COPY_US_REQUIRE_COMPAT_POSITION === "false") return false;
  return isUsOnlyLiveCopyMode();
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

async function loadOpenPositionCandidates(
  traderId: string,
  address: string,
  fetchTrades: boolean,
): Promise<
  Array<{
    marketId: string;
    title: string;
    slug: string | null;
    category: string | null;
  }>
> {
  const dbPositions = await prisma.position.findMany({
    where: { traderId, status: "open" },
    include: { market: { select: { id: true, title: true, slug: true, category: true } } },
    take: 12,
  });

  if (dbPositions.length > 0) {
    return dbPositions.map((p) => ({
      marketId: p.marketId,
      title: p.market.title,
      slug: p.market.slug,
      category: p.market.category,
    }));
  }

  if (!fetchTrades) return [];

  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet: address,
    limit: 40,
  });
  return netOpenTitlesFromTrades(res.data ?? []).map((p) => ({
    marketId: p.marketId,
    title: p.title,
    slug: p.slug,
    category: null,
  }));
}

/** Fast ingest path — no US API; full gate runs at leader pick / live copy. */
export async function scoreTraderUsLiveCompatFast(
  traderId: string,
  address: string,
): Promise<UsLeaderCompatScore> {
  const candidates = await loadOpenPositionCandidates(traderId, address, true);
  return {
    openPositions: candidates.length,
    likelyGlobalOnly: 0,
    usCompatible: 0,
    bestConfidence: 0,
    hasTradeableUsPosition: false,
  };
}

/** Full US catalog gate — strict ≥0.90 confidence required. */
export async function scoreTraderUsLiveCompat(
  traderId: string,
  address: string,
  opts?: { catalogOnly?: boolean; allowScanFetch?: boolean },
): Promise<UsLeaderCompatScore> {
  const candidates = await loadOpenPositionCandidates(
    traderId,
    address,
    opts?.allowScanFetch === true,
  );
  if (candidates.length === 0) {
    return {
      openPositions: 0,
      likelyGlobalOnly: 0,
      usCompatible: 0,
      bestConfidence: 0,
      hasTradeableUsPosition: false,
    };
  }

  let usCompatible = 0;
  let bestConfidence = 0;

  const toCheck = candidates.slice(0, MAX_FULL_GATE_POSITIONS);
  for (const pos of toCheck) {
    const gate = opts?.catalogOnly
      ? await evaluateUsCatalogMatch({
          globalMarketId: pos.marketId,
          globalTitle: pos.title,
          globalSlug: pos.slug,
          side: "yes",
          category: pos.category,
        })
      : await evaluateUsCompatibilityGate({
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
    likelyGlobalOnly: 0,
    usCompatible,
    bestConfidence,
    hasTradeableUsPosition: usCompatible > 0 && bestConfidence >= 0.9,
  };
}

export function maxFullGateLeaders(): number {
  return Number.isFinite(MAX_FULL_GATE_LEADERS) && MAX_FULL_GATE_LEADERS > 0
    ? MAX_FULL_GATE_LEADERS
    : 15;
}
