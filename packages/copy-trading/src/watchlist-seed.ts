import { prisma } from "@augurium/database";
import { evaluateUsCatalogMatch } from "@augurium/execution";
import {
  mapToSpecialtyBucket,
  polymarketScanFetch,
  type ScanTraderBadge,
  type ScanWalletPnlSummary,
  type ScanWalletTrade,
} from "@augurium/shared";
import { buildTraderTruth } from "./trader-truth.js";
import { evaluateCopyV1LeaderGate, getCopyV1Thresholds } from "./copy-v1-gates.js";

const TRADE_LIMIT = Number(process.env.POLYMARKET_SCAN_TRADES_LIMIT ?? "200");
const MAX_OPEN_POSITIONS = Number(process.env.POSITION_SYNC_MAX_OPEN ?? "12");
const MAX_US_MATCH_POSITIONS = Number(process.env.COPY_US_COMPAT_MAX_GATE_CHECKS ?? "3");

export const DEFAULT_MLB_WATCHLIST_SEED = {
  wallet: "0x89dd49bf87c41be422927372a0b75c6ab577f662",
  notes: "sports-mlb — 100% US BAL/SEA open",
} as const;

export interface WatchlistSeedResult {
  wallet: string;
  watchlistId: string | null;
  metricsFound: boolean;
  positionsSynced: number;
  usMatchConfidence: number;
  leaderGatesPass: boolean;
  gateReasons: string[];
  skipped?: boolean;
  skipReason?: string;
}

function badgeScore(badges: ScanTraderBadge[]): number {
  if (!badges.length) return 0;
  const whale = badges.filter((b) => b.badge_type.includes("whale")).length;
  const insider = badges.filter((b) => b.badge_type.includes("insider")).length;
  return whale * 15 + insider * 10 + badges.length;
}

function pnlToRanking(summary: ScanWalletPnlSummary | null | undefined): number {
  if (!summary) return 0;
  const roi = Number(summary.roi ?? summary.roi_percent ?? 0);
  const pnl = Number(summary.total_pnl ?? summary.realized_pnl ?? 0);
  const winRate = Number(summary.win_rate ?? 0);
  return Math.max(0, roi * 100 + winRate * 20 + Math.log10(Math.max(1, Math.abs(pnl))) * 5);
}

function scanTier(trades: number, winRate: number, roi: number): string {
  if (trades >= 100 && winRate >= 0.6 && roi >= 0.12) return "ELITE";
  if (trades >= 50 && winRate >= 0.55 && roi > 0) return "RISING";
  return "UNRANKED";
}

async function upsertTraderFromWallet(address: string, discoveredVia: string): Promise<string> {
  const normalized = address.toLowerCase();
  const trader = await prisma.trader.upsert({
    where: { address: normalized },
    create: {
      address: normalized,
      discoveredVia,
      firstSeenAt: new Date(),
      lastActivityAt: new Date(),
    },
    update: { lastActivityAt: new Date() },
  });
  return trader.id;
}

async function upsertScanMetricsSnapshot(
  traderId: string,
  summary: ScanWalletPnlSummary | null | undefined,
  rankingScore: number,
): Promise<void> {
  const recent = await prisma.traderMetricsSnapshot.findFirst({
    where: {
      traderId,
      capturedAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) return;

  const tradeCount = Math.max(0, Math.floor(Number(summary?.trade_count ?? 0)));
  const winRate = Number(summary?.win_rate ?? 0);
  const roi = Number(summary?.roi ?? summary?.roi_percent ?? 0);
  const realizedPnl = Number(summary?.realized_pnl ?? summary?.total_pnl ?? 0);
  const unrealizedPnl = Number(summary?.unrealized_pnl ?? 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const copyability = Math.min(1, winRate * 0.55 + Math.max(0, roi + 0.05) * 0.45);
  const confidence = Math.min(
    1,
    (tradeCount >= 100 ? 0.55 : tradeCount / 200) + winRate * 0.35 + Math.min(0.1, roi),
  );
  const recentForm = Math.min(1, winRate * 0.7 + Math.max(0, roi) * 0.3);
  const maxDrawdown = roi > 0.15 ? 0.05 : roi > 0 ? 0.08 : roi > -0.05 ? 0.12 : 0.2;
  const tier = scanTier(tradeCount, winRate, roi);

  await prisma.traderMetricsSnapshot.create({
    data: {
      traderId,
      tradeCount,
      marketCount: Math.max(1, Math.floor(tradeCount / 4)),
      totalVolume: Math.abs(totalPnl) * 8,
      activeDays: Math.min(365, Math.max(30, tradeCount)),
      averageTradeSize: tradeCount > 0 ? Math.abs(totalPnl) / tradeCount : 0,
      averagePositionSize: tradeCount > 0 ? Math.abs(totalPnl) / tradeCount : 0,
      realizedPnl,
      unrealizedPnl,
      estimatedTotalPnl: totalPnl,
      roi,
      winRate,
      lossRate: Math.max(0, 1 - winRate),
      averageWin: roi > 0 ? roi * 0.4 : 0,
      averageLoss: roi > 0 ? roi * 0.15 : 0.1,
      profitFactor: winRate > 0 ? winRate / Math.max(0.05, 1 - winRate) : 0,
      maxDrawdown,
      consistencyScore: recentForm,
      roi7d: roi,
      roi30d: roi,
      roi90d: roi,
      roi180d: roi,
      volume7d: 0,
      volume30d: Math.abs(totalPnl),
      tradeCount7d: Math.min(tradeCount, 10),
      tradeCount30d: Math.min(tradeCount, 40),
      copyabilityScore: copyability,
      estimatedCopiedRoi: roi * copyability,
      averageSlippageEstimate: 0.02,
      averageExecutionDelayEstimate: 45,
      mirrorabilityScore: copyability,
      copiedProfitFactor: 1,
      informationEdgeScore: confidence,
      confidenceScore: confidence,
      recentFormScore: recentForm,
      rankingScore,
      tier,
      specialistScore: copyability,
      lowConfidence: tradeCount < 100,
      rankingReason: "watchlist seed polymarketscan wallet_pnl",
    },
  });
}

/** Pull PolymarketScan PnL into Trader + metrics snapshot so v1 gates can evaluate. */
export async function ingestWatchlistWalletFromScan(wallet: string): Promise<string> {
  const traderRes = await polymarketScanFetch<{ badges?: ScanTraderBadge[] }>("trader", { wallet });
  const pnlRes = await polymarketScanFetch<{ summary?: ScanWalletPnlSummary | null }>("wallet_pnl", {
    wallet,
  });

  const badges = traderRes.data?.badges ?? [];
  const rankingScore = Math.max(pnlToRanking(pnlRes.data?.summary), badgeScore(badges));
  const roi = Number(pnlRes.data?.summary?.roi ?? pnlRes.data?.summary?.roi_percent ?? 0);
  const winRate = Number(pnlRes.data?.summary?.win_rate ?? 0);
  const trades = Number(pnlRes.data?.summary?.trade_count ?? 0);

  const traderId = await upsertTraderFromWallet(wallet, "polymarket-scan-watchlist");
  const tier = scanTier(trades, winRate, roi);
  const copyability = Math.min(1, winRate * 0.55 + Math.max(0, roi + 0.05) * 0.45);
  const confidence = Math.min(
    1,
    (trades >= 100 ? 0.55 : trades / 200) + winRate * 0.35 + Math.min(0.1, roi),
  );

  await prisma.trader.update({
    where: { id: traderId },
    data: {
      rankingScore,
      score: rankingScore,
      roi,
      winRate,
      trades: trades > 0 ? trades : undefined,
      tier,
      copyabilityScore: copyability,
      confidenceScore: confidence,
      recentFormScore: Math.min(1, winRate * 0.7 + Math.max(0, roi) * 0.3),
      lowConfidence: trades < 100,
      lastScoredAt: new Date(),
      discoveredVia: "polymarket-scan-watchlist",
      bestCategory: "Sports",
    },
  });

  await upsertScanMetricsSnapshot(traderId, pnlRes.data?.summary, rankingScore);
  return traderId;
}

function positionExternalKey(wallet: string, conditionId: string, asset: string): string {
  return `${wallet.toLowerCase()}:${conditionId}:${asset}`;
}

async function ensureGlobalMarketForScanTrade(trade: ScanWalletTrade): Promise<string | null> {
  const title =
    trade.market_question?.trim() ||
    `Scan market ${trade.market.slice(0, Math.min(12, trade.market.length))}`;
  const eventSlug = trade.event_slug?.trim() || null;
  const category = mapToSpecialtyBucket({ title, slug: eventSlug });
  const isCondition = trade.market.startsWith("0x");
  const externalId = isCondition ? trade.market : `scan:${trade.market}`;

  const existing = await prisma.market.findFirst({
    where: {
      OR: isCondition
        ? [{ conditionId: trade.market }, { externalId: trade.market }]
        : [{ externalId }],
    },
    select: { id: true, slug: true },
  });
  if (existing) {
    if (eventSlug && !existing.slug) {
      await prisma.market.update({
        where: { id: existing.id },
        data: { slug: eventSlug, eventSlug },
      });
    }
    return existing.id;
  }

  try {
    const row = await prisma.market.create({
      data: {
        externalId,
        conditionId: isCondition ? trade.market : null,
        source: "polymarket-scan",
        title,
        slug: eventSlug,
        eventSlug,
        category,
        active: true,
      },
    });
    return row.id;
  } catch {
    const recovered = await prisma.market.findFirst({
      where: {
        OR: isCondition
          ? [{ conditionId: trade.market }, { externalId }]
          : [{ externalId }],
      },
      select: { id: true },
    });
    return recovered?.id ?? null;
  }
}

function netPositionsFromTrades(trades: ScanWalletTrade[]): Array<{
  marketId: string;
  conditionId: string;
  side: string;
  size: number;
  avgPrice: number;
  pnl: number;
}> {
  const byKey = new Map<
    string,
    { marketId: string; conditionId: string; side: string; shares: number; cost: number }
  >();

  const sorted = [...trades].sort(
    (a, b) => new Date(a.trade_timestamp).getTime() - new Date(b.trade_timestamp).getTime(),
  );

  for (const t of sorted) {
    const key = `${t.market}:${t.outcome}`;
    const row = byKey.get(key) ?? {
      marketId: t.market,
      conditionId: t.market,
      side: t.outcome,
      shares: 0,
      cost: 0,
    };
    const signed = t.side === "SELL" ? -t.size : t.size;
    if (signed > 0) {
      row.cost += signed * t.price;
      row.shares += signed;
    } else {
      const sell = -signed;
      const avg = row.shares > 0 ? row.cost / row.shares : t.price;
      row.shares = Math.max(0, row.shares - sell);
      row.cost = row.shares * avg;
    }
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .filter((r) => r.shares > 0.01)
    .map((r) => ({
      marketId: r.marketId,
      conditionId: r.conditionId,
      side: r.side,
      size: r.shares,
      avgPrice: r.shares > 0 ? r.cost / r.shares : 0,
      pnl: 0,
    }));
}

export async function syncPositionsFromPolymarketScanForTrader(trader: {
  id: string;
  address: string;
}): Promise<number> {
  const res = await polymarketScanFetch<ScanWalletTrade[]>("wallet_trades", {
    wallet: trader.address,
    limit: TRADE_LIMIT,
  });

  if (!res.ok || !res.data) return 0;

  const nets = netPositionsFromTrades(res.data).slice(0, MAX_OPEN_POSITIONS);
  let synced = 0;

  for (const pos of nets) {
    const sample =
      res.data.find((t) => t.market === pos.conditionId && t.outcome === pos.side) ??
      res.data.find((t) => t.market === pos.conditionId);
    const marketId = await ensureGlobalMarketForScanTrade({
      market: pos.conditionId,
      market_question: sample?.market_question ?? pos.side,
      event_slug: sample?.event_slug,
      outcome: pos.side,
      side: "BUY",
      price: pos.avgPrice,
      size: pos.size,
      trade_timestamp: new Date().toISOString(),
      transaction_hash: `scan:${trader.address}:${pos.conditionId}`,
    });
    if (!marketId) continue;

    const key = positionExternalKey(trader.address, pos.conditionId, pos.side);
    await prisma.position.upsert({
      where: { externalKey: key },
      create: {
        externalKey: key,
        traderId: trader.id,
        marketId,
        conditionId: pos.conditionId,
        side: pos.side,
        size: pos.size,
        avgPrice: pos.avgPrice,
        pnl: pos.pnl,
        source: "polymarket-scan",
        status: "open",
        syncedAt: new Date(),
      },
      update: {
        marketId,
        size: pos.size,
        avgPrice: pos.avgPrice,
        status: "open",
        syncedAt: new Date(),
      },
    });
    synced++;
  }

  return synced;
}

export async function scoreWatchlistUsCatalogMatch(traderId: string): Promise<number> {
  const positions = await prisma.position.findMany({
    where: { traderId, status: "open" },
    include: { market: { select: { id: true, title: true, slug: true, category: true } } },
    take: 12,
  });
  if (positions.length === 0) return 0;

  let bestConfidence = 0;
  for (const pos of positions.slice(0, MAX_US_MATCH_POSITIONS)) {
    const gate = await evaluateUsCatalogMatch({
      globalMarketId: pos.marketId,
      globalTitle: pos.market.title,
      globalSlug: pos.market.slug,
      side: "yes",
      category: pos.market.category,
    });
    bestConfidence = Math.max(bestConfidence, gate.confidence);
  }
  return bestConfidence;
}

async function evaluateLeaderGates(
  traderId: string,
  usMatchConfidence: number,
): Promise<{ pass: boolean; reasons: string[] }> {
  const trader = await prisma.trader.findUnique({ where: { id: traderId } });
  if (!trader) return { pass: false, reasons: ["trader not found"] };

  const snap = await prisma.traderMetricsSnapshot.findFirst({
    where: { traderId },
    orderBy: { capturedAt: "desc" },
  });

  const truth = buildTraderTruth(trader, snap);
  const gate = evaluateCopyV1LeaderGate({
    truth,
    usMatchConfidence,
    usMatchEvaluated: true,
    recentDrawdown: snap?.maxDrawdown,
  });
  return { pass: gate.pass, reasons: gate.reasons };
}

function isValidWallet(wallet: string): boolean {
  return /^0x[a-f0-9]{40}$/i.test(wallet);
}

export async function seedUsLeaderWatchlistWallet(input: {
  wallet: string;
  notes?: string;
  upsertWatchlist?: boolean;
  requireUsMatch?: boolean;
}): Promise<WatchlistSeedResult> {
  const wallet = input.wallet.trim().toLowerCase();
  if (!isValidWallet(wallet)) {
    throw new Error("invalid wallet address (expected 0x + 40 hex chars)");
  }

  const upsertWatchlist = input.upsertWatchlist !== false;
  const requireUsMatch = input.requireUsMatch === true;
  const minUsMatch = getCopyV1Thresholds().minUsMatch;

  let watchlistId: string | null = null;
  if (upsertWatchlist) {
    const row = await prisma.usLeaderWatchlist.upsert({
      where: { wallet },
      create: { wallet, enabled: true, notes: input.notes ?? null },
      update: { enabled: true, ...(input.notes !== undefined ? { notes: input.notes } : {}) },
    });
    watchlistId = row.id;
  }

  const traderId = await ingestWatchlistWalletFromScan(wallet);
  const pnlRes = await polymarketScanFetch<{ summary?: ScanWalletPnlSummary | null }>("wallet_pnl", {
    wallet,
  });
  const metricsFound = Boolean(pnlRes.ok && pnlRes.data?.summary);

  const positionsSynced = await syncPositionsFromPolymarketScanForTrader({
    id: traderId,
    address: wallet,
  });

  const usMatchConfidence = await scoreWatchlistUsCatalogMatch(traderId);
  const gateEval = await evaluateLeaderGates(traderId, usMatchConfidence);

  if (requireUsMatch && usMatchConfidence < minUsMatch) {
    if (watchlistId) {
      await prisma.usLeaderWatchlist.update({
        where: { id: watchlistId },
        data: { enabled: false },
      });
    }
    return {
      wallet,
      watchlistId,
      metricsFound,
      positionsSynced,
      usMatchConfidence,
      leaderGatesPass: false,
      gateReasons: [
        ...gateEval.reasons,
        `US match ${(usMatchConfidence * 100).toFixed(0)}% < ${minUsMatch * 100}% (seed rejected)`,
      ],
      skipped: true,
      skipReason: "us_match_below_threshold",
    };
  }

  return {
    wallet,
    watchlistId,
    metricsFound,
    positionsSynced,
    usMatchConfidence,
    leaderGatesPass: gateEval.pass,
    gateReasons: gateEval.reasons,
  };
}

/** Auto-seed disabled — watchlist is optional admin-only, not a pipeline dependency. */
export async function maybeAutoSeedDefaultWatchlist(): Promise<WatchlistSeedResult | null> {
  return null;
}
