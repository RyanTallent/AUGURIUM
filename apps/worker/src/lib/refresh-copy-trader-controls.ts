import { prisma } from "@augurium/database";
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
import { scoreTraderUsLiveCompat, usLeaderCompatRequired, maxFullGateLeaders } from "./us-leader-compat.js";
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

function usGateRefreshLimit(pool: number): number {
  const raw = process.env.COPY_US_GATE_REFRESH_LIMIT ?? String(pool);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), pool) : pool;
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

/** Keep CopyTraderControl in sync with v1 scoring gates. */
export async function refreshCopyTraderControls(): Promise<CopyControlsRefreshResult> {
  const pool = Math.min(refreshEvaluateBatch(), copyCandidatePoolSize());
  const gateLimit = usGateRefreshLimit(pool);
  const profileLimit = Math.min(categoryProfileBatch(), gateLimit);
  console.log(
    `[worker] copy trader controls start pool=${pool} usGate=ALL(${gateLimit}) profileBatch=${profileLimit}`,
  );

  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  const priorControls = await prisma.copyTraderControl.findMany({
    where: { traderId: { in: traders.map((t) => t.id) } },
    select: { traderId: true, enabled: true },
  });
  const priorEnabled = new Map(priorControls.map((p) => [p.traderId, p.enabled]));

  const profileTraderIds = new Set(
    traders
      .slice(0, profileLimit)
      .map((t) => t.id),
  );

  let copyEnabled = 0;
  const promoted: string[] = [];
  const cooled: string[] = [];
  const failReasons = new Map<string, number>();
  const deprioritize: Array<{ wallet: string; reason: string }> = [];
  const leadersByCategory: Record<string, number> = {};
  const bestMatchedMarkets: CopyControlsRefreshResult["bestMatchedMarkets"] = [];
  let usEvaluated = 0;
  let skippedZeroUsOverlap = 0;

  let cursorMeta = (
    await prisma.syncCursor.findUnique({
      where: { stream: "polymarket-scan:leaderboard" },
      select: { metadata: true },
    })
  )?.metadata as Record<string, unknown> | null;

  for (let i = 0; i < traders.length; i++) {
    const t = traders[i];
    const snap = t.metricsSnapshots[0] ?? null;
    const truth = buildTraderTruth(t, snap);
    const legacy = applyRiskToDecision(decideCopyTrader(truth), truth);

    let usMatch = 0;
    let usMatchEvaluated = false;
    let specialistScore = truth.copyabilityScore;
    let categoryNote: string | null = null;

    const compat = await scoreTraderUsLiveCompat(t.id, t.address, {
      catalogOnly: true,
      allowScanFetch: true,
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

    const prior = priorEnabled.get(t.id);
    if (prior === false && enabled) promoted.push(t.address);
    if (prior === true && !enabled) cooled.push(t.address);

    const strengths = [
      ...legacy.strengths,
      `v1 L${v1.scores.lifetime.toFixed(0)} H${v1.scores.heat.toFixed(0)} C${v1.scores.conviction.toFixed(0)}`,
    ];
    if (categoryNote) strengths.push(categoryNote);
    const weaknesses =
      v1.reasons.length > 0 ? v1.reasons : legacy.weaknesses;

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

    if (i > 0 && i % 5 === 0) {
      console.log(`[worker] copy trader controls progress ${i}/${traders.length}`);
    }
  }

  if (promoted.length > 0 || cooled.length > 0) {
    await notifyBrainLeaderChange({ promoted, cooled, copyEnabled });
  }

  for (const row of deprioritize) {
    cursorMeta = mergeDeprioritizedWallet(cursorMeta, row.wallet, row.reason);
  }

  if (deprioritize.length > 0 || cursorMeta) {
    await prisma.syncCursor.update({
      where: { stream: "polymarket-scan:leaderboard" },
      data: { metadata: (cursorMeta ?? {}) as object },
    });
    if (deprioritize.length > 0) {
      console.log(`[worker] deprioritized ${deprioritize.length} low-US-overlap scan wallet(s)`);
    }
  }

  const topFails = [...failReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  if (traders.length > 0) {
    const topFailsLog = topFails
      .slice(0, 4)
      .map(({ reason, count }) => `${count}x ${reason}`)
      .join(" | ");
    console.log(
      `[worker] copy trader controls refreshed pool=${pool} usGate=${gateLimit} evaluated=${traders.length} copyEnabled=${copyEnabled}${topFailsLog ? ` topFails=${topFailsLog}` : ""}`,
    );
  }

  return {
    evaluated: traders.length,
    copyEnabled,
    topFails,
    leadersByCategory,
    sampledWallets: traders.length,
    usEvaluated,
    skippedZeroUsOverlap,
    bestMatchedMarkets: bestMatchedMarkets
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8),
  };
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

  const scored = await Promise.all(
    rows.slice(0, maxFullGateLeaders()).map(async (row) => {
      const compat = await scoreTraderUsLiveCompat(row.trader.id, row.trader.address, {
        catalogOnly: true,
        allowScanFetch: true,
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
      return {
        row,
        compat,
        pickScore: profilePick,
        bucket: leaderCategoryBucket(row.trader.bestCategory),
      };
    }),
  );

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
