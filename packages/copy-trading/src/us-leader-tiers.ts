import type { UsWalletScore } from "./us-wallet-scoring.js";

export type UsLeaderTier = "RISING_STAR" | "ESTABLISHED" | "NONE";

export interface UsLeaderTierThresholds {
  risingMinTrades: number;
  risingMinLifetimeRoi: number;
  risingMinRecentRoi: number;
  risingMaxDrawdown: number;
  establishedMinTrades: number;
  establishedMinLifetimeRoi: number;
  establishedMinRecentRoi: number;
  establishedMinConsistency: number;
  establishedMaxDrawdown: number;
  minLeaders: number;
  targetLeaders: number;
  maxLeaders: number;
}

export function getUsLeaderTierThresholds(): UsLeaderTierThresholds {
  return {
    risingMinTrades: Number(process.env.US_TIER_RISING_MIN_TRADES ?? "25"),
    risingMinLifetimeRoi: Number(process.env.US_TIER_RISING_MIN_LIFETIME_ROI ?? "0"),
    risingMinRecentRoi: Number(process.env.US_TIER_RISING_MIN_RECENT_ROI ?? "0"),
    risingMaxDrawdown: Number(process.env.US_TIER_RISING_MAX_DRAWDOWN ?? "0.20"),
    establishedMinTrades: Number(process.env.US_TIER_ESTABLISHED_MIN_TRADES ?? "100"),
    establishedMinLifetimeRoi: Number(process.env.US_TIER_ESTABLISHED_MIN_LIFETIME_ROI ?? "0.05"),
    establishedMinRecentRoi: Number(process.env.US_TIER_ESTABLISHED_MIN_RECENT_ROI ?? "0"),
    establishedMinConsistency: Number(process.env.US_TIER_ESTABLISHED_MIN_CONSISTENCY ?? "0.55"),
    establishedMaxDrawdown: Number(process.env.US_TIER_ESTABLISHED_MAX_DRAWDOWN ?? "0.15"),
    minLeaders: Number(process.env.COPY_LIVE_MIN_LEADERS ?? "3"),
    targetLeaders: Number(process.env.COPY_LIVE_TARGET_LEADERS ?? "10"),
    maxLeaders: Number(process.env.COPY_LIVE_MAX_LEADERS ?? "25"),
  };
}

export interface UsLeaderTierResult {
  tier: UsLeaderTier;
  pass: boolean;
  reasons: string[];
  pickScore: number;
}

export function classifyUsLeaderTier(score: UsWalletScore): UsLeaderTier {
  const t = getUsLeaderTierThresholds();
  const established =
    score.tradeCount >= t.establishedMinTrades &&
    score.lifetimeRoi >= t.establishedMinLifetimeRoi &&
    score.recentRoi >= t.establishedMinRecentRoi &&
    score.consistency >= t.establishedMinConsistency &&
    score.maxDrawdown <= t.establishedMaxDrawdown;

  if (established) return "ESTABLISHED";

  const rising =
    score.tradeCount >= t.risingMinTrades &&
    score.lifetimeRoi > t.risingMinLifetimeRoi &&
    score.recentRoi > t.risingMinRecentRoi &&
    score.maxDrawdown <= t.risingMaxDrawdown;

  if (rising) return "RISING_STAR";
  return "NONE";
}

export function evaluateUsLeaderTierGate(score: UsWalletScore): UsLeaderTierResult {
  const tier = classifyUsLeaderTier(score);
  const reasons: string[] = [];
  const t = getUsLeaderTierThresholds();

  if (tier === "NONE") {
    if (score.tradeCount < t.risingMinTrades) {
      reasons.push(`trade count ${score.tradeCount} < ${t.risingMinTrades}`);
    }
    if (score.lifetimeRoi <= t.risingMinLifetimeRoi) {
      reasons.push(`lifetime ROI ${(score.lifetimeRoi * 100).toFixed(1)}% not positive`);
    }
    if (score.recentRoi <= t.risingMinRecentRoi) {
      reasons.push(`recent ROI ${(score.recentRoi * 100).toFixed(1)}% not positive`);
    }
    if (score.maxDrawdown > t.risingMaxDrawdown) {
      reasons.push(`drawdown ${(score.maxDrawdown * 100).toFixed(0)}% > ${t.risingMaxDrawdown * 100}%`);
    }
  }

  const pickScore =
    tier === "ESTABLISHED"
      ? score.rankingScore + 20
      : tier === "RISING_STAR"
        ? score.rankingScore + 8
        : score.rankingScore * 0.5;

  return { tier, pass: tier !== "NONE", reasons, pickScore };
}

export function evaluateUsLeaderEntryGate(input: {
  score: UsWalletScore;
  leaderPnl: number;
  leaderSize: number;
  leaderAvgPrice: number;
}): { pass: boolean; reasons: string[]; lateCopy: boolean } {
  const tier = evaluateUsLeaderTierGate(input.score);
  const reasons = [...tier.reasons];
  const maxLeaderRoi = Number(process.env.COPY_MAX_SOURCE_ROI_TO_MIRROR ?? "0.20");
  const cost = input.leaderSize * input.leaderAvgPrice;
  const roi = cost > 0 ? input.leaderPnl / cost : 0;
  let lateCopy = false;

  if (!tier.pass) {
    return { pass: false, reasons, lateCopy };
  }

  if (roi > maxLeaderRoi) {
    lateCopy = true;
    reasons.push(`leader ROI ${(roi * 100).toFixed(0)}% > ${maxLeaderRoi * 100}% (late copy)`);
    return { pass: false, reasons, lateCopy };
  }

  return { pass: true, reasons: [], lateCopy };
}

/** Routine pipeline skips — no Discord noise for tier/late-copy failures. */
export function isRoutineUsTierSkipReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes("trade count") ||
    r.includes("lifetime roi") ||
    r.includes("recent roi") ||
    r.includes("drawdown") ||
    r.includes("late copy") ||
    r.includes("leader roi") ||
    r.includes("no deploy room") ||
    r.includes("exposure would exceed")
  );
}
