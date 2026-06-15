import type { SpecialtyBucket } from "@augurium/shared";

export interface CategoryBucketMetric {
  bucket: SpecialtyBucket;
  tradeCount: number;
  openCount: number;
  volumeUsd: number;
  winRate: number;
  specialistScore: number;
  bestUsMatch: number;
  usCompatibleOpens: number;
}

export interface TraderCategoryProfile {
  buckets: CategoryBucketMetric[];
  primaryBucket: SpecialtyBucket | null;
  bestUsBucket: SpecialtyBucket | null;
  bestUsMatch: number;
  hasTradeableUs: boolean;
  usOverlapRatio: number;
  /** Specialist score for the best US-overlap bucket (or primary if none). */
  activeSpecialistScore: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function computeBucketSpecialistScore(input: {
  tradeCount: number;
  totalTrades: number;
  volumeUsd: number;
  totalVolumeUsd: number;
  winRate: number;
}): number {
  const tradeShare = input.totalTrades > 0 ? input.tradeCount / input.totalTrades : 0;
  const volShare = input.totalVolumeUsd > 0 ? input.volumeUsd / input.totalVolumeUsd : 0;
  const wrBonus = clamp01(input.winRate);
  return clamp01(tradeShare * 0.4 + volShare * 0.35 + wrBonus * 0.25);
}

export function buildTraderCategoryProfile(
  buckets: CategoryBucketMetric[],
): TraderCategoryProfile {
  if (buckets.length === 0) {
    return {
      buckets: [],
      primaryBucket: null,
      bestUsBucket: null,
      bestUsMatch: 0,
      hasTradeableUs: false,
      usOverlapRatio: 0,
      activeSpecialistScore: 0,
    };
  }

  const primary = [...buckets].sort(
    (a, b) => b.specialistScore - a.specialistScore || b.tradeCount - a.tradeCount,
  )[0];

  const usViable = buckets.filter((b) => b.bestUsMatch >= 0.9 && b.usCompatibleOpens > 0);
  const bestUs = usViable.length
    ? [...usViable].sort(
        (a, b) =>
          b.bestUsMatch - a.bestUsMatch ||
          b.specialistScore - a.specialistScore ||
          b.usCompatibleOpens - a.usCompatibleOpens,
      )[0]
    : [...buckets].sort((a, b) => b.bestUsMatch - a.bestUsMatch)[0];

  const totalOpens = buckets.reduce((s, b) => s + b.openCount, 0);
  const usOpens = buckets.reduce((s, b) => s + b.usCompatibleOpens, 0);

  const activeSpecialistScore =
    bestUs && bestUs.bestUsMatch >= 0.9
      ? bestUs.specialistScore
      : (primary?.specialistScore ?? 0);

  return {
    buckets,
    primaryBucket: primary?.bucket ?? null,
    bestUsBucket: bestUs?.bucket ?? null,
    bestUsMatch: bestUs?.bestUsMatch ?? 0,
    hasTradeableUs: usViable.length > 0,
    usOverlapRatio: totalOpens > 0 ? usOpens / totalOpens : 0,
    activeSpecialistScore,
  };
}

/** Leaders trading mostly non-US markets should be deprioritized from scan rotation. */
export function shouldDeprioritizeScanWallet(profile: TraderCategoryProfile): boolean {
  const minTrades = Number(process.env.COPY_SCAN_DEPRIORITIZE_MIN_TRADES ?? "15");
  const totalTrades = profile.buckets.reduce((s, b) => s + b.tradeCount, 0);
  if (totalTrades < minTrades) return false;
  if (profile.hasTradeableUs) return false;
  if (profile.usOverlapRatio > 0.05) return false;
  if (profile.bestUsMatch >= 0.75) return false;
  return true;
}

export function categoryLeaderPickScore(profile: TraderCategoryProfile, copyScore: number): number {
  const usWeight = profile.hasTradeableUs ? profile.bestUsMatch * 40 : profile.bestUsMatch * 10;
  const overlapWeight = profile.usOverlapRatio * 20;
  const specialtyWeight = profile.activeSpecialistScore * 15;
  return usWeight + overlapWeight + specialtyWeight + copyScore * 0.35;
}
