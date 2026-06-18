import { prisma, type Trader, type TraderMetricsSnapshot } from "@augurium/database";
import { usePolymarketScanIntel, formatSpecialtyBucketLabel } from "@augurium/shared";
import {
  applyRiskToDecision,
  buildTraderTruth,
  decideCopyTrader,
  evaluateCopyV1LeaderGate,
  shouldDeprioritizeScanWallet,
  categoryLeaderPickScore,
  type TraderCategoryProfile,
} from "@augurium/copy-trading";
import { usLeaderCompatRequired, maxFullGateLeaders } from "./us-leader-compat.js";
import { scoreTraderUsLiveCompatCached } from "./us-compat-cache.js";
import { loadLastSlowFunnelMeta, saveLastSlowFunnelMeta } from "./copy-pipeline-rhythm.js";
import { notifyBrainLeaderChange } from "./enqueue-live-copy-discord.js";
import { buildScanTraderCategoryProfile } from "./scan-trader-category-profile.js";
import {
  mergeDeprioritizedWallet,
  parseDeprioritizedWallets,
  trackUsMatchZeroStreak,
  clearUsMatchZeroStreak,
  shouldDeprioritizeForZeroStreak,
} from "./scan-category-discovery.js";

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
  const raw = process.env.COPY_LIVE_MAX_LEADERS ?? process.env.COPY_MAX_LEADERS ?? "15";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

export function copyMinLeaders(): number {
  const raw = process.env.COPY_LIVE_MIN_LEADERS ?? "5";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}


function categoryProfileBatch(): number {
  const raw = process.env.COPY_CATEGORY_PROFILE_BATCH ?? "20";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

function refreshEvaluateBatch(): number {
  const raw = process.env.COPY_CONTROLS_REFRESH_BATCH ?? "50";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

async function persistCategoryMetrics(
  traderId: string,
  profile: TraderCategoryProfile,
): Promise<void> {
  const snap = await prisma.traderMetricsSnapshot.findFirst({
    where: { traderId },
    orderBy: { capturedAt: "desc" },
    select: { id: true },
  });
  if (!snap) return;

  await prisma.traderCategoryMetric.deleteMany({ where: { snapshotId: snap.id } });
  if (profile.buckets.length > 0) {
    await prisma.traderCategoryMetric.createMany({
      data: profile.buckets.map((b) => ({
        snapshotId: snap.id,
        category: b.bucket,
        tradeCount: b.tradeCount,
        volume: b.volumeUsd,
        roi: 0,
        winRate: b.winRate,
        specialistScore: b.specialistScore,
      })),
    });
  }

  const label = formatSpecialtyBucketLabel(profile.bestUsBucket ?? profile.primaryBucket);
  await prisma.traderMetricsSnapshot.update({
    where: { id: snap.id },
    data: {
      bestCategory: profile.bestUsBucket ?? profile.primaryBucket ?? undefined,
      specialistCategory: profile.primaryBucket ?? undefined,
      specialistScore: profile.activeSpecialistScore,
    },
  });
  await prisma.trader.update({
    where: { id: traderId },
    data: {
      bestCategory: profile.bestUsBucket ?? profile.primaryBucket ?? undefined,
    },
  });
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
          discoveredVia: "polymarket-scan-watchlist",
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
    profileLimit: number;
    allowScanFetch: boolean;
    forceCompat: boolean;
    priorEnabled: Map<string, boolean>;
    cursorMeta: Record<string, unknown> | null;
  },
): Promise<{
  copyEnabled: number;
  promoted: string[];
  cooled: string[];
  failReasons: Map<string, number>;
  deprioritize: Array<{ wallet: string; reason: string }>;
  leadersByCategory: Record<string, number>;
  bestMatchedMarkets: CopyControlsRefreshResult["bestMatchedMarkets"];
  usEvaluated: number;
  skippedZeroUsOverlap: number;
  cursorMeta: Record<string, unknown> | null;
}> {
  const profileTraderIds = new Set(traders.slice(0, opts.profileLimit).map((t) => t.id));
  let copyEnabled = 0;
  const promoted: string[] = [];
  const cooled: string[] = [];
  const failReasons = new Map<string, number>();
  const deprioritize: Array<{ wallet: string; reason: string }> = [];
  const leadersByCategory: Record<string, number> = {};
  const bestMatchedMarkets: CopyControlsRefreshResult["bestMatchedMarkets"] = [];
  let usEvaluated = 0;
  let skippedZeroUsOverlap = 0;
  let cursorMeta = opts.cursorMeta;

  for (let i = 0; i < traders.length; i++) {
    const t = traders[i];
    const snap = t.metricsSnapshots[0] ?? null;
    const truth = buildTraderTruth(t, snap);
    const legacy = applyRiskToDecision(decideCopyTrader(truth), truth);

    let usMatch = 0;
    let usMatchEvaluated = false;
    let specialistScore = truth.copyabilityScore;
    let categoryNote: string | null = null;

    const compat = await scoreTraderUsLiveCompatCached(t.id, t.address, {
      catalogOnly: true,
      allowScanFetch: opts.allowScanFetch,
      force: opts.forceCompat,
    });
    usMatch = compat.bestConfidence;
    usMatchEvaluated = true;
    usEvaluated++;

    if (usMatch <= 0) {
      skippedZeroUsOverlap++;
      cursorMeta = trackUsMatchZeroStreak(cursorMeta, t.address);
      if (shouldDeprioritizeForZeroStreak(cursorMeta, t.address)) {
        deprioritize.push({ wallet: t.address, reason: "repeated US match 0%" });
      }
    } else {
      cursorMeta = clearUsMatchZeroStreak(cursorMeta, t.address);
    }

    if (profileTraderIds.has(t.id) && usePolymarketScanIntel() && usMatch >= 0.5) {
      try {
        const profile = await buildScanTraderCategoryProfile(t.address);
        usMatch = Math.max(usMatch, profile.bestUsMatch);
        specialistScore = profile.activeSpecialistScore;
        categoryNote = profile.bestUsBucket
          ? `${profile.bestUsBucket} US ${(profile.bestUsMatch * 100).toFixed(0)}%`
          : profile.primaryBucket
            ? `${profile.primaryBucket} specialist`
            : null;
        await persistCategoryMetrics(t.id, profile);
        if (shouldDeprioritizeScanWallet(profile)) {
          deprioritize.push({
            wallet: t.address,
            reason: `low US overlap (${(profile.usOverlapRatio * 100).toFixed(0)}%)`,
          });
        }
        if (profile.bestUsMatch >= 0.9 && profile.hasTradeableUs) {
          const topBucket = profile.buckets.find((b) => b.bestUsMatch >= 0.9);
          if (topBucket) {
            bestMatchedMarkets.push({
              wallet: t.address,
              globalTitle: `${topBucket.bucket} open positions`,
              usTitle: `${topBucket.bucket} US ${(topBucket.bestUsMatch * 100).toFixed(0)}%`,
              confidence: topBucket.bestUsMatch,
            });
          }
        }
      } catch (err) {
        console.warn(
          `[worker] category profile failed ${t.address.slice(0, 10)}…`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const v1 = evaluateCopyV1LeaderGate({
      truth,
      usMatchConfidence: usMatch,
      usMatchEvaluated,
      specialistScore,
    });
    const enabled = v1.pass && legacy.recommendation !== "AVOID";
    if (enabled) {
      copyEnabled++;
      const cat = t.bestCategory ?? categoryNote?.split(" ")[0] ?? "Other";
      leadersByCategory[cat] = (leadersByCategory[cat] ?? 0) + 1;
    } else if (v1.reasons[0]) {
      const key = v1.reasons[0].split(" < ")[0] ?? v1.reasons[0];
      failReasons.set(key, (failReasons.get(key) ?? 0) + 1);
    }

    const prior = opts.priorEnabled.get(t.id);
    if (prior === false && enabled) promoted.push(t.address);
    if (prior === true && !enabled) cooled.push(t.address);

    const strengths = [
      ...legacy.strengths,
      `v1 L${v1.scores.lifetime.toFixed(0)} H${v1.scores.heat.toFixed(0)} C${v1.scores.conviction.toFixed(0)}`,
    ];
    if (categoryNote) strengths.push(categoryNote);
    const weaknesses = v1.reasons.length > 0 ? v1.reasons : legacy.weaknesses;

    await prisma.copyTraderControl.upsert({
      where: { traderId: t.id },
      create: {
        traderId: t.id,
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: v1.scores.conviction,
        riskScore: v1.scores.uncertainty,
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "v1 gate failed",
        strengths,
        weaknesses,
      },
      update: {
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: v1.scores.conviction,
        riskScore: v1.scores.uncertainty,
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "v1 gate failed",
        strengths,
        weaknesses,
        evaluatedAt: new Date(),
      },
    });
  }

  return {
    copyEnabled,
    promoted,
    cooled,
    failReasons,
    deprioritize,
    leadersByCategory,
    bestMatchedMarkets,
    usEvaluated,
    skippedZeroUsOverlap,
    cursorMeta,
  };
}

/** Fast path — re-validate enabled leaders + watchlist only (no 50-wallet sweep). */
async function refreshCopyTraderControlsFast(): Promise<CopyControlsRefreshResult> {
  const lastSlow = await loadLastSlowFunnelMeta();
  const max = fastControlsMax();
  console.log(`[worker] copy trader controls FAST max=${max}`);

  const enabledRows = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    include: {
      trader: { include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } } },
    },
  });

  const watchlistTraders = await loadWatchlistTraders();
  const traderById = new Map<string, TraderRow>();
  for (const row of enabledRows) {
    traderById.set(row.trader.id, row.trader);
  }
  for (const w of watchlistTraders) {
    if (!traderById.has(w.id)) traderById.set(w.id, w);
  }

  const traders = [...traderById.values()].slice(0, max);
  const priorEnabled = new Map(
    (await prisma.copyTraderControl.findMany({
      where: { traderId: { in: traders.map((t) => t.id) } },
      select: { traderId: true, enabled: true },
    })).map((p) => [p.traderId, p.enabled]),
  );

  const cursorMeta = (
    await prisma.syncCursor.findUnique({
      where: { stream: "polymarket-scan:leaderboard" },
      select: { metadata: true },
    })
  )?.metadata as Record<string, unknown> | null;

  const result = await evaluateTraderControls(traders, {
    profileLimit: 0,
    allowScanFetch: false,
    forceCompat: false,
    priorEnabled,
    cursorMeta,
  });

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

  console.log(
    `[worker] copy trader controls FAST evaluated=${traders.length} copyEnabled=${copyEnabled}`,
  );

  return {
    evaluated: traders.length,
    copyEnabled,
    topFails,
    leadersByCategory: result.leadersByCategory,
    sampledWallets: traders.length,
    usEvaluated: result.usEvaluated,
    skippedZeroUsOverlap: result.skippedZeroUsOverlap,
    bestMatchedMarkets:
      (lastSlow?.bestMatchedMarkets as CopyControlsRefreshResult["bestMatchedMarkets"]) ?? [],
  };
}

/** Slow path — rotated discovery batch + category profiling (30–60 min). */
async function refreshCopyTraderControlsSlow(): Promise<CopyControlsRefreshResult> {
  const pool = Math.min(refreshEvaluateBatch(), copyCandidatePoolSize());
  const batch = slowControlsBatch();
  const profileLimit = Math.min(categoryProfileBatch(), batch);
  console.log(
    `[worker] copy trader controls SLOW pool=${pool} batch=${batch} profileBatch=${profileLimit}`,
  );

  const poolTraders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  const rotateCursor = await prisma.syncCursor.findUnique({
    where: { stream: "copy:controls-rotate" },
    select: { cursorValue: true },
  });
  const offset = Number(rotateCursor?.cursorValue ?? "0") % Math.max(poolTraders.length, 1);
  const rotated = [
    ...poolTraders.slice(offset),
    ...poolTraders.slice(0, offset),
  ].slice(0, batch);

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

  let cursorMeta = (
    await prisma.syncCursor.findUnique({
      where: { stream: "polymarket-scan:leaderboard" },
      select: { metadata: true },
    })
  )?.metadata as Record<string, unknown> | null;

  const result = await evaluateTraderControls(traders, {
    profileLimit,
    allowScanFetch: true,
    forceCompat: true,
    priorEnabled,
    cursorMeta,
  });
  cursorMeta = result.cursorMeta;

  if (result.promoted.length > 0 || result.cooled.length > 0) {
    await notifyBrainLeaderChange({
      promoted: result.promoted,
      cooled: result.cooled,
      copyEnabled: result.copyEnabled,
    });
  }

  for (const row of result.deprioritize) {
    cursorMeta = mergeDeprioritizedWallet(cursorMeta, row.wallet, row.reason);
  }

  if (result.deprioritize.length > 0 || cursorMeta) {
    await prisma.syncCursor.upsert({
      where: { stream: "polymarket-scan:leaderboard" },
      create: {
        stream: "polymarket-scan:leaderboard",
        cursorType: "metadata",
        cursorValue: "0",
        metadata: (cursorMeta ?? {}) as object,
      },
      update: { metadata: (cursorMeta ?? {}) as object },
    });
  }

  const nextOffset = (offset + batch) % Math.max(poolTraders.length, 1);
  await prisma.syncCursor.upsert({
    where: { stream: "copy:controls-rotate" },
    create: {
      stream: "copy:controls-rotate",
      cursorType: "offset",
      cursorValue: String(nextOffset),
    },
    update: { cursorValue: String(nextOffset) },
  });

  const topFails = [...result.failReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  const bestMatchedMarkets = result.bestMatchedMarkets
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  const copyEnabled = await prisma.copyTraderControl.count({ where: { enabled: true } });

  await saveLastSlowFunnelMeta({
    topFails,
    bestMatchedMarkets,
    evaluated: traders.length,
    usEvaluated: result.usEvaluated,
    skippedZeroUsOverlap: result.skippedZeroUsOverlap,
    at: new Date().toISOString(),
  });

  if (traders.length > 0) {
    const topFailsLog = topFails
      .slice(0, 4)
      .map(({ reason, count }) => `${count}x ${reason}`)
      .join(" | ");
    console.log(
      `[worker] copy trader controls SLOW batch=${batch} offset=${offset} evaluated=${traders.length} copyEnabled=${copyEnabled}${topFailsLog ? ` topFails=${topFailsLog}` : ""}`,
    );
  }

  return {
    evaluated: traders.length,
    copyEnabled,
    topFails,
    leadersByCategory: result.leadersByCategory,
    sampledWallets: traders.length,
    usEvaluated: result.usEvaluated,
    skippedZeroUsOverlap: result.skippedZeroUsOverlap,
    bestMatchedMarkets,
  };
}

/** Keep CopyTraderControl in sync with v1 scoring gates. */
export async function refreshCopyTraderControls(opts?: {
  mode?: "fast" | "slow";
}): Promise<CopyControlsRefreshResult> {
  if (opts?.mode === "fast") return refreshCopyTraderControlsFast();
  if (opts?.mode === "slow") return refreshCopyTraderControlsSlow();

  // Legacy full sweep when mode unspecified (non-US paths).
  return refreshCopyTraderControlsSlow();
}

function leaderCategoryBucket(
  bestCategory: string | null | undefined,
): string {
  return bestCategory ?? "Other";
}

export async function loadTopCopyLeaderIds(): Promise<string[]> {
  const maxLeaders = copyMaxLeaders();
  const minLeaders = copyMinLeaders();
  const maxPerCategory = Number(process.env.COPY_LEADER_MAX_PER_CATEGORY ?? "4");

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

  if (!usLeaderCompatRequired() || rows.length === 0) {
    return balanceLeadersByCategory(
      rows.map((r) => ({
        traderId: r.traderId,
        bucket: leaderCategoryBucket(r.trader.bestCategory),
        copyScore: r.copyScore,
      })),
      maxLeaders,
      maxPerCategory,
    ).map((r) => r.traderId);
  }

  const scored: Array<{
    row: (typeof rows)[number];
    compat: Awaited<ReturnType<typeof scoreTraderUsLiveCompatCached>>;
    pickScore: number;
    bucket: string;
  }> = [];

  for (const row of rows.slice(0, maxFullGateLeaders())) {
    const compat = await scoreTraderUsLiveCompatCached(row.trader.id, row.trader.address, {
      catalogOnly: true,
      allowScanFetch: false,
    });
    const profilePick = categoryLeaderPickScore(
      {
        buckets: [],
        primaryBucket: null,
        bestUsBucket: null,
        bestUsMatch: compat.bestConfidence,
        hasTradeableUs: compat.hasTradeableUsPosition,
        usOverlapRatio: compat.openPositions > 0 ? compat.usCompatible / compat.openPositions : 0,
        activeSpecialistScore: row.copyScore / 100,
      },
      row.copyScore,
    );
    scored.push({
      row,
      compat,
      pickScore: profilePick,
      bucket: leaderCategoryBucket(row.trader.bestCategory),
    });
  }

  const tradeable = scored
    .filter((r) => r.compat.hasTradeableUsPosition && r.compat.bestConfidence >= 0.9)
    .sort((a, b) => b.pickScore - a.pickScore);

  if (tradeable.length > 0) {
    const balanced = balanceLeadersByCategory(
      tradeable.map((t) => ({ traderId: t.row.traderId, bucket: t.bucket, copyScore: t.pickScore })),
      maxLeaders,
      maxPerCategory,
    );
    if (balanced.length >= minLeaders || balanced.length === tradeable.length) {
      return balanced.map((r) => r.traderId);
    }
    return balanced.map((r) => r.traderId);
  }

  return rows.slice(0, Math.min(maxLeaders, minLeaders)).map((r) => r.traderId);
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
