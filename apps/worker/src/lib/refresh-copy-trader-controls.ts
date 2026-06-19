import { prisma, type Trader, type TraderMetricsSnapshot } from "@augurium/database";
import { formatSpecialtyBucketLabel } from "@augurium/shared";
import {
  applyRiskToDecision,
  buildTraderTruth,
  decideCopyTrader,
  computeUsWalletScore,
  evaluateUsLeaderTierGate,
  getUsLeaderTierThresholds,
  type UsLeaderTier,
} from "@augurium/copy-trading";
import { loadLastSlowFunnelMeta, saveLastSlowFunnelMeta } from "./copy-pipeline-rhythm.js";
import { notifyBrainLeaderChange } from "./enqueue-live-copy-discord.js";

export interface CopyControlsRefreshResult {
  evaluated: number;
  copyEnabled: number;
  topFails: Array<{ reason: string; count: number }>;
  leadersByCategory: Record<string, number>;
  sampledWallets: number;
  usEvaluated: number;
  skippedZeroUsOverlap: number;
  bestMatchedMarkets: Array<{
    wallet: string;
    globalTitle: string;
    usTitle: string;
    confidence: number;
  }>;
}

export function copyCandidatePoolSize(): number {
  const raw =
    process.env.COPY_LIVE_CANDIDATE_POOL ??
    process.env.COPY_CANDIDATE_POOL ??
    "500";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function copyMaxLeaders(): number {
  const raw = process.env.COPY_LIVE_MAX_LEADERS ?? process.env.COPY_MAX_LEADERS ?? "25";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

export function copyMinLeaders(): number {
  const raw = process.env.COPY_LIVE_MIN_LEADERS ?? "3";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

function slowControlsBatch(): number {
  const raw = process.env.COPY_SLOW_CONTROLS_BATCH ?? "15";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

function fastControlsMax(): number {
  const raw = process.env.COPY_FAST_CONTROLS_MAX ?? "12";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
}

function refreshEvaluateBatch(): number {
  const raw = process.env.COPY_CONTROLS_REFRESH_BATCH ?? "50";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

type TraderRow = Pick<
  Trader,
  | "id"
  | "address"
  | "tier"
  | "copyabilityScore"
  | "confidenceScore"
  | "estimatedCopiedRoi"
  | "rankingScore"
  | "winRate"
  | "roi"
  | "trades"
  | "recentFormScore"
  | "bestCategory"
  | "lowConfidence"
  | "lastScoredAt"
> & {
  metricsSnapshots: TraderMetricsSnapshot[];
};

async function loadWatchlistTraders(): Promise<TraderRow[]> {
  const rows = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    take: 8,
  });
  const out: TraderRow[] = [];

  for (const w of rows) {
    let trader = await prisma.trader.findFirst({
      where: { address: w.wallet.toLowerCase() },
      include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    });
    if (!trader) {
      trader = await prisma.trader.create({
        data: {
          address: w.wallet.toLowerCase(),
          discoveredVia: "us-admin-watchlist",
          rankingScore: 50,
          lastScoredAt: new Date(),
        },
        include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
      });
    }
    out.push({
      id: trader.id,
      address: trader.address,
      tier: trader.tier,
      copyabilityScore: trader.copyabilityScore,
      confidenceScore: trader.confidenceScore,
      estimatedCopiedRoi: trader.estimatedCopiedRoi,
      rankingScore: trader.rankingScore,
      winRate: trader.winRate,
      roi: trader.roi,
      trades: trader.trades,
      recentFormScore: trader.recentFormScore,
      bestCategory: trader.bestCategory,
      lowConfidence: trader.lowConfidence,
      lastScoredAt: trader.lastScoredAt,
      metricsSnapshots: trader.metricsSnapshots,
    });
  }
  return out;
}

async function evaluateTraderControls(
  traders: TraderRow[],
  opts: {
    priorEnabled: Map<string, boolean>;
  },
): Promise<{
  copyEnabled: number;
  promoted: string[];
  cooled: string[];
  failReasons: Map<string, number>;
  leadersByCategory: Record<string, number>;
  leadersByTier: Record<UsLeaderTier, number>;
}> {
  let copyEnabled = 0;
  const promoted: string[] = [];
  const cooled: string[] = [];
  const failReasons = new Map<string, number>();
  const leadersByCategory: Record<string, number> = {};
  const leadersByTier: Record<UsLeaderTier, number> = {
    RISING_STAR: 0,
    ESTABLISHED: 0,
    NONE: 0,
  };

  for (const t of traders) {
    const snap = t.metricsSnapshots[0] ?? null;
    const truth = buildTraderTruth(t, snap);
    const legacy = applyRiskToDecision(decideCopyTrader(truth), truth);
    const usScore = computeUsWalletScore({ truth, categorySpecialty: t.bestCategory });
    const tierGate = evaluateUsLeaderTierGate(usScore);
    leadersByTier[tierGate.tier] = (leadersByTier[tierGate.tier] ?? 0) + 1;

    const enabled = tierGate.pass && legacy.recommendation !== "AVOID";
    if (enabled) {
      copyEnabled++;
      const cat = t.bestCategory ?? usScore.categorySpecialty ?? "Other";
      leadersByCategory[cat] = (leadersByCategory[cat] ?? 0) + 1;
    } else if (tierGate.reasons[0]) {
      const key = tierGate.reasons[0].split(" < ")[0] ?? tierGate.reasons[0];
      failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
    }

    const prior = opts.priorEnabled.get(t.id);
    if (prior === false && enabled) promoted.push(t.address);
    if (prior === true && !enabled) cooled.push(t.address);

    const strengths = [
      ...legacy.strengths,
      `US tier ${tierGate.tier} score=${usScore.rankingScore.toFixed(0)}`,
    ];
    const categoryNote = usScore.categorySpecialty
      ? `${formatSpecialtyBucketLabel(usScore.categorySpecialty as Parameters<typeof formatSpecialtyBucketLabel>[0])} specialist`
      : null;
    if (categoryNote) strengths.push(categoryNote);
    const weaknesses = tierGate.reasons.length > 0 ? tierGate.reasons : legacy.weaknesses;

    await prisma.copyTraderControl.upsert({
      where: { traderId: t.id },
      create: {
        traderId: t.id,
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: tierGate.pickScore,
        riskScore: Math.max(0, 100 - usScore.rankingScore),
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "US tier gate failed",
        strengths,
        weaknesses,
      },
      update: {
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: tierGate.pickScore,
        riskScore: Math.max(0, 100 - usScore.rankingScore),
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "US tier gate failed",
        strengths,
        weaknesses,
        evaluatedAt: new Date(),
      },
    });
  }

  return { copyEnabled, promoted, cooled, failReasons, leadersByCategory, leadersByTier };
}

async function refreshCopyTraderControlsFast(): Promise<CopyControlsRefreshResult> {
  const lastSlow = await loadLastSlowFunnelMeta();
  const max = fastControlsMax();

  const enabledRows = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    include: {
      trader: { include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } } },
    },
  });

  const watchlistTraders = await loadWatchlistTraders();
  const traderById = new Map<string, TraderRow>();
  for (const row of enabledRows) traderById.set(row.trader.id, row.trader);
  for (const w of watchlistTraders) {
    if (!traderById.has(w.id)) traderById.set(w.id, w);
  }

  const traders = [...traderById.values()].slice(0, max);
  const priorEnabled = new Map(
    (
      await prisma.copyTraderControl.findMany({
        where: { traderId: { in: traders.map((t) => t.id) } },
        select: { traderId: true, enabled: true },
      })
    ).map((p) => [p.traderId, p.enabled]),
  );

  const result = await evaluateTraderControls(traders, { priorEnabled });

  if (result.promoted.length > 0 || result.cooled.length > 0) {
    await notifyBrainLeaderChange({
      promoted: result.promoted,
      cooled: result.cooled,
      copyEnabled: result.copyEnabled,
    });
  }

  const copyEnabled = await prisma.copyTraderControl.count({ where: { enabled: true } });
  const topFails =
    (lastSlow?.topFails as Array<{ reason: string; count: number }> | undefined) ?? [];

  return {
    evaluated: traders.length,
    copyEnabled,
    topFails,
    leadersByCategory: result.leadersByCategory,
    sampledWallets: traders.length,
    usEvaluated: traders.length,
    skippedZeroUsOverlap: 0,
    bestMatchedMarkets: [],
  };
}

async function refreshCopyTraderControlsSlow(): Promise<CopyControlsRefreshResult> {
  const pool = Math.min(refreshEvaluateBatch(), copyCandidatePoolSize());
  const batch = slowControlsBatch();

  const poolTraders = await prisma.trader.findMany({
    where: {
      lastScoredAt: { not: null },
      rankingScore: { gt: 0 },
      OR: [
        { discoveredVia: "polymarket-scan-us-intel" },
        { discoveredVia: "polymarket-us-trades" },
        { tradeRows: { some: { source: "polymarket-us" } } },
      ],
    },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  const rotateCursor = await prisma.syncCursor.findUnique({
    where: { stream: "copy:controls-rotate" },
    select: { cursorValue: true },
  });
  const offset = Number(rotateCursor?.cursorValue ?? "0") % Math.max(poolTraders.length, 1);
  const rotated = [...poolTraders.slice(offset), ...poolTraders.slice(0, offset)].slice(0, batch);

  const watchlistTraders = await loadWatchlistTraders();
  const traderById = new Map<string, TraderRow>();
  for (const t of rotated) traderById.set(t.id, t);
  for (const w of watchlistTraders) {
    if (!traderById.has(w.id)) traderById.set(w.id, w);
  }
  const traders = [...traderById.values()];

  const priorControls = await prisma.copyTraderControl.findMany({
    where: { traderId: { in: traders.map((t) => t.id) } },
    select: { traderId: true, enabled: true },
  });
  const priorEnabled = new Map(priorControls.map((p) => [p.traderId, p.enabled]));

  const result = await evaluateTraderControls(traders, { priorEnabled });

  if (result.promoted.length > 0 || result.cooled.length > 0) {
    await notifyBrainLeaderChange({
      promoted: result.promoted,
      cooled: result.cooled,
      copyEnabled: result.copyEnabled,
    });
  }

  const nextOffset = (offset + batch) % Math.max(poolTraders.length, 1);
  await prisma.syncCursor.upsert({
    where: { stream: "copy:controls-rotate" },
    create: { stream: "copy:controls-rotate", cursorType: "offset", cursorValue: String(nextOffset) },
    update: { cursorValue: String(nextOffset) },
  });

  const topFails = [...result.failReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  const copyEnabled = await prisma.copyTraderControl.count({ where: { enabled: true } });

  await saveLastSlowFunnelMeta({
    topFails,
    bestMatchedMarkets: [],
    evaluated: traders.length,
    usEvaluated: traders.length,
    skippedZeroUsOverlap: 0,
    at: new Date().toISOString(),
  });

  return {
    evaluated: traders.length,
    copyEnabled,
    topFails,
    leadersByCategory: result.leadersByCategory,
    sampledWallets: traders.length,
    usEvaluated: traders.length,
    skippedZeroUsOverlap: 0,
    bestMatchedMarkets: [],
  };
}

export async function refreshCopyTraderControls(opts?: {
  mode?: "fast" | "slow";
}): Promise<CopyControlsRefreshResult> {
  if (opts?.mode === "fast") return refreshCopyTraderControlsFast();
  return refreshCopyTraderControlsSlow();
}

function leaderCategoryBucket(bestCategory: string | null | undefined): string {
  return bestCategory ?? "Other";
}

export async function loadTopCopyLeaderIds(): Promise<string[]> {
  const thresholds = getUsLeaderTierThresholds();
  const maxLeaders = Math.min(copyMaxLeaders(), thresholds.maxLeaders);
  const minLeaders = copyMinLeaders();
  const maxPerCategory = Number(process.env.COPY_LEADER_MAX_PER_CATEGORY ?? "5");

  const rows = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: [{ copyScore: "desc" }, { evaluatedAt: "desc" }],
    take: Math.max(maxLeaders * 3, 30),
    include: {
      trader: {
        select: { id: true, address: true, bestCategory: true },
      },
    },
  });

  const balanced = balanceLeadersByCategory(
    rows.map((r) => ({
      traderId: r.traderId,
      bucket: leaderCategoryBucket(r.trader.bestCategory),
      copyScore: r.copyScore,
    })),
    maxLeaders,
    maxPerCategory,
  );

  if (balanced.length >= minLeaders) return balanced.map((r) => r.traderId);
  return rows.slice(0, Math.max(minLeaders, balanced.length)).map((r) => r.traderId);
}

function balanceLeadersByCategory<T extends { traderId: string; bucket?: string; copyScore?: number }>(
  rows: T[],
  maxLeaders: number,
  maxPerCategory: number,
): T[] {
  const bucketCounts = new Map<string, number>();
  const picked: T[] = [];
  const sorted = [...rows].sort((a, b) => (b.copyScore ?? 0) - (a.copyScore ?? 0));

  for (const row of sorted) {
    if (picked.length >= maxLeaders) break;
    const bucket = row.bucket ?? "Other";
    const count = bucketCounts.get(bucket) ?? 0;
    if (count >= maxPerCategory) continue;
    bucketCounts.set(bucket, count + 1);
    picked.push(row);
  }

  if (picked.length < maxLeaders) {
    for (const row of sorted) {
      if (picked.length >= maxLeaders) break;
      if (picked.some((p) => p.traderId === row.traderId)) continue;
      picked.push(row);
    }
  }

  return picked;
}
