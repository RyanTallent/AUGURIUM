import { usePolymarketScanIntel } from "@augurium/shared";
import { leaderPositionRoi } from "./copy-mirror-rules.js";
import { computeScoringV1, type ScoringV1Result } from "./scoring-v1.js";
import type { TraderTruthMetrics } from "./trader-truth.js";

export interface CopyV1Thresholds {
  minLifetime: number;
  minHeat: number;
  minConfidence: number;
  maxUncertainty: number;
  minConviction: number;
  minWinRate: number;
  minTradeCount: number;
  maxRecentDrawdown: number;
  minUsMatch: number;
  maxLeaderRoi: number;
}

export function getCopyV1Thresholds(): CopyV1Thresholds {
  // Scan summaries cap lifetime ~82 for strong leaders; 85 is unreachable without full trade history.
  const scanLifetimeDefault = usePolymarketScanIntel() ? "80" : "85";
  return {
    minLifetime: Number(process.env.COPY_V1_MIN_LIFETIME ?? scanLifetimeDefault),
    minHeat: Number(process.env.COPY_V1_MIN_HEAT ?? "75"),
    minConfidence: Number(process.env.COPY_V1_MIN_CONFIDENCE ?? "80"),
    maxUncertainty: Number(process.env.COPY_V1_MAX_UNCERTAINTY ?? "35"),
    minConviction: Number(process.env.COPY_V1_MIN_CONVICTION ?? "75"),
    minWinRate: Number(process.env.COPY_V1_MIN_WIN_RATE ?? "0.60"),
    minTradeCount: Number(process.env.COPY_V1_MIN_TRADE_COUNT ?? "100"),
    maxRecentDrawdown: Number(process.env.COPY_V1_MAX_RECENT_DRAWDOWN ?? "0.15"),
    minUsMatch: Number(process.env.COPY_V1_MIN_US_MATCH ?? "0.90"),
    maxLeaderRoi: Number(process.env.COPY_MAX_SOURCE_ROI_TO_MIRROR ?? "0.20"),
  };
}

export interface CopyV1GateResult {
  pass: boolean;
  scores: ScoringV1Result;
  reasons: string[];
}

export function evaluateCopyV1LeaderGate(input: {
  truth: TraderTruthMetrics;
  usMatchConfidence?: number;
  usMatchEvaluated?: boolean;
  recentDrawdown?: number;
  specialistScore?: number;
}): CopyV1GateResult {
  const scores = computeScoringV1({
    truth: input.truth,
    usMatchConfidence: input.usMatchConfidence,
    recentDrawdown: input.recentDrawdown,
    specialistScore: input.specialistScore,
    usMatchHardGated: true,
  });
  const reasons: string[] = [];
  const t = getCopyV1Thresholds();

  if (input.usMatchEvaluated === false) {
    reasons.push("US compat not evaluated");
  } else if ((input.usMatchConfidence ?? 0) < t.minUsMatch) {
    reasons.push(`US match ${((input.usMatchConfidence ?? 0) * 100).toFixed(0)}% < ${t.minUsMatch * 100}%`);
  }
  if (input.truth.tradeCount < t.minTradeCount) {
    reasons.push(`trade count ${input.truth.tradeCount} < ${t.minTradeCount}`);
  }
  if (input.truth.winRate < t.minWinRate) {
    reasons.push(`win rate ${(input.truth.winRate * 100).toFixed(0)}% < ${t.minWinRate * 100}%`);
  }
  if (scores.lifetime < t.minLifetime) reasons.push(`lifetime ${scores.lifetime} < ${t.minLifetime}`);
  if (scores.heat < t.minHeat) reasons.push(`heat ${scores.heat} < ${t.minHeat}`);
  if (scores.confidence < t.minConfidence) {
    reasons.push(`confidence ${scores.confidence} < ${t.minConfidence}`);
  }
  if (scores.uncertainty > t.maxUncertainty) {
    reasons.push(`uncertainty ${scores.uncertainty} > ${t.maxUncertainty}`);
  }
  if (scores.conviction < t.minConviction) {
    reasons.push(`conviction ${scores.conviction} < ${t.minConviction}`);
  }
  const recentDd = input.recentDrawdown ?? input.truth.maxDrawdown;
  if (recentDd > t.maxRecentDrawdown) {
    reasons.push(`recent drawdown ${(recentDd * 100).toFixed(0)}% > ${t.maxRecentDrawdown * 100}%`);
  }

  return { pass: reasons.length === 0, scores, reasons };
}

export function evaluateCopyV1EntryGate(input: {
  truth: TraderTruthMetrics;
  usMatchConfidence: number;
  leaderPnl: number;
  leaderSize: number;
  leaderAvgPrice: number;
}): CopyV1GateResult {
  const roi = leaderPositionRoi(input.leaderPnl, input.leaderSize, input.leaderAvgPrice);
  const t = getCopyV1Thresholds();
  const base = evaluateCopyV1LeaderGate({
    truth: input.truth,
    usMatchConfidence: input.usMatchConfidence,
  });

  if (roi > t.maxLeaderRoi) {
    base.reasons.push(`leader ROI ${(roi * 100).toFixed(0)}% > ${t.maxLeaderRoi * 100}% (late copy)`);
    base.pass = false;
  }

  if (base.scores.conviction < 60) {
    base.reasons.push(`conviction ${base.scores.conviction} < 60 (skip sizing tier)`);
    base.pass = false;
  }

  return base;
}

/** Routine pipeline skips — no Discord, no BLOCKED mirror rows. */
export function isRoutineCopySkipReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes("late copy") ||
    r.includes("leader roi") ||
    r.includes("lifetime ") ||
    r.includes("heat ") ||
    r.includes("confidence ") ||
    r.includes("uncertainty ") ||
    r.includes("conviction ") ||
    r.includes("win rate") ||
    r.includes("trade count") ||
    r.includes("drawdown") ||
    r.includes("us match") ||
    r.includes("uncertain match") ||
    r.includes("no us-compatible") ||
    r.includes("no us catalog") ||
    r.includes("global-only") ||
    r.includes("exposure would exceed") ||
    r.includes("no deploy room") ||
    r.includes("insufficient buying power") ||
    r.includes("skip sizing tier")
  );
}
