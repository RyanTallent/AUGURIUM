import { prisma } from "@augurium/database";
import { evaluateUsCompatibilityGate } from "@augurium/execution";
import { isUsOnlyLiveCopyMode, isUsBroadIntelMode } from "@augurium/shared";
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

const US_LIKELY_PATTERNS = [
  /\bcounter-strike\b/i,
  /\bvalorant\b/i,
  /\bdota\s*2?\b/i,
  /\bleague of legends\b/i,
  /\bcs2\b/i,
  /\bmlb\b/i,
  /\bnba\b/i,
  /\bnfl\b/i,
  /\bnhl\b/i,
  /\bsoccer\b/i,
  /\btennis\b/i,
  /\besports\b/i,
  /\bpresident\b/i,
  /\belection\b/i,
  /\bsuper bowl\b/i,
  /\bworld series\b/i,
];

const MAX_FULL_GATE_POSITIONS = Number(process.env.COPY_US_COMPAT_MAX_GATE_CHECKS ?? "2");
const MAX_FULL_GATE_LEADERS = Number(process.env.COPY_US_COMPAT_MAX_LEADERS ?? "5");

export function isLikelyGlobalOnlyMarketTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return GLOBAL_ONLY_PATTERNS.some((p) => p.test(t));
}

export function isLikelyUsOverlapMarketTitle(title: string): boolean {
  if (isLikelyGlobalOnlyMarketTitle(title)) return false;
  const norm = title.toLowerCase();
  if (norm.includes(" vs ") || norm.includes(" vs. ")) return true;
  return US_LIKELY_PATTERNS.some((p) => p.test(norm));
}

export function usLeaderCompatRequired(): boolean {
  if (process.env.COPY_US_REQUIRE_COMPAT_POSITION === "true") return isUsOnlyLiveCopyMode();
  if (process.env.COPY_US_REQUIRE_COMPAT_POSITION === "false") return false;
  // Default off when broad intel is on (matches relaxed US slug matching).
  return isUsOnlyLiveCopyMode() && !isUsBroadIntelMode();
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

function scoreCandidatesFast(
  candidates: Array<{
    marketId: string;
    title: string;
    slug: string | null;
    category: string | null;
  }>,
): UsLeaderCompatScore {
  let likelyGlobalOnly = 0;
  let usCompatible = 0;

  for (const pos of candidates) {
    if (isLikelyGlobalOnlyMarketTitle(pos.title)) {
      likelyGlobalOnly++;
      continue;
    }
    if (isLikelyUsOverlapMarketTitle(pos.title)) usCompatible++;
  }

  return {
    openPositions: candidates.length,
    likelyGlobalOnly,
    usCompatible,
    bestConfidence: usCompatible > 0 ? 0.75 : 0,
    hasTradeableUsPosition: usCompatible > 0,
  };
}

/** Fast heuristic only — safe for PolymarketScan ingest (no US API calls). */
export async function scoreTraderUsLiveCompatFast(
  traderId: string,
  address: string,
): Promise<UsLeaderCompatScore> {
  const candidates = await loadOpenPositionCandidates(traderId, address, true);
  return scoreCandidatesFast(candidates);
}

/** Full US gate — use sparingly (live copy leader pick / position filter). */
export async function scoreTraderUsLiveCompat(
  traderId: string,
  address: string,
): Promise<UsLeaderCompatScore> {
  const candidates = await loadOpenPositionCandidates(traderId, address, false);
  if (candidates.length === 0) {
    return scoreTraderUsLiveCompatFast(traderId, address);
  }

  const fast = scoreCandidatesFast(candidates);
  if (fast.openPositions > 0 && fast.usCompatible === 0) {
    return fast;
  }

  let usCompatible = 0;
  let bestConfidence = fast.bestConfidence;
  let likelyGlobalOnly = fast.likelyGlobalOnly;

  const toCheck = candidates
    .filter((p) => !isLikelyGlobalOnlyMarketTitle(p.title))
    .slice(0, MAX_FULL_GATE_POSITIONS);

  for (const pos of toCheck) {
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
    usCompatible: Math.max(usCompatible, fast.usCompatible),
    bestConfidence,
    hasTradeableUsPosition: usCompatible > 0 || fast.hasTradeableUsPosition,
  };
}

export function maxFullGateLeaders(): number {
  return Number.isFinite(MAX_FULL_GATE_LEADERS) && MAX_FULL_GATE_LEADERS > 0
    ? MAX_FULL_GATE_LEADERS
    : 5;
}
