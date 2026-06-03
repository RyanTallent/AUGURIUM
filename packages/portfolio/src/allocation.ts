import { getPortfolioConfig } from "./config.js";
import { computeCompositeScore } from "./composite-score.js";
import {
  categoryExposure,
  deployedPct,
  findWeakestPosition,
  isMaxDeployed,
  wouldExceedDeployedCap,
} from "./limits.js";
import { computeRiskScore } from "./risk-score.js";
import {
  applySizingModifiers,
  basePositionPctFromScore,
  clampPositionPct,
  sizeUsdFromPct,
} from "./sizing.js";
import type {
  AllocationResult,
  PortfolioContext,
  PortfolioDecisionType,
  SignalInputs,
} from "./types.js";

const ELIGIBLE_TYPES = new Set(["TRADE_NOW", "WATCHLIST", "RESEARCH"]);

export function evaluateSignalAllocation(
  input: SignalInputs,
  ctx: PortfolioContext,
): AllocationResult {
  const config = getPortfolioConfig();
  const reasons: string[] = [];
  const openMarketIds = new Set(ctx.openPositions.map((p) => p.marketId));
  const catExp = categoryExposure(
    ctx.openPositions,
    input.category,
    ctx.tradingBankroll,
  );
  const riskScore = computeRiskScore(
    input,
    openMarketIds,
    catExp,
    config.maxCategoryExposurePct,
  );
  const compositeScore = computeCompositeScore(input);

  if (!ELIGIBLE_TYPES.has(input.signalType) || input.signalType === "IGNORE") {
    return reject(compositeScore, riskScore, ["signal type IGNORE — ineligible"]);
  }

  if (ctx.dailyLossUsd >= config.maxDailyLossUsd) {
    return reject(compositeScore, riskScore, [
      `daily loss cap reached ($${ctx.dailyLossUsd.toFixed(2)})`,
    ]);
  }

  const basePct = basePositionPctFromScore(compositeScore);
  if (basePct <= 0) {
    if (compositeScore >= 75 && input.signalType !== "IGNORE") {
      return watch(compositeScore, riskScore, ["score 75–79 — watch only"]);
    }
    return reject(compositeScore, riskScore, ["composite score below 80"]);
  }

  const duplicateMarket = openMarketIds.has(input.marketId);
  const categoryOverCap =
    !!input.category &&
    catExp >= config.maxCategoryExposurePct;

  const { pct: modPct, reasons: modReasons } = applySizingModifiers(basePct, {
    systemConfidence: input.systemConfidenceScore,
    marketQuality: input.marketQualityScore,
    liquidityScore: input.liquidityScore,
    drawdownMode: ctx.drawdownMode,
    duplicateMarket,
    categoryOverCap,
  });
  reasons.push(...modReasons);

  const { pct: clampedPct } = clampPositionPct(modPct, compositeScore, config);
  let recommendedPct = clampedPct;
  let recommendedSizeUsd = sizeUsdFromPct(ctx.tradingBankroll, recommendedPct);

  const weakest = findWeakestPosition(ctx.openPositions);
  const reallocationEligible =
    isMaxDeployed(ctx.deployedCapital, ctx.tradingBankroll, config) &&
    weakest &&
    compositeScore >= weakest.compositeScore + config.reallocationScoreGap;

  if (reallocationEligible) {
    const headroom =
      ctx.tradingBankroll * config.maxDeployedPct - ctx.deployedCapital;
    if (headroom > 0 && recommendedSizeUsd > headroom) {
      recommendedSizeUsd = headroom;
      recommendedPct = recommendedSizeUsd / ctx.tradingBankroll;
    }
    return {
      decision: "REALLOCATE",
      compositeScore,
      riskScore,
      recommendedSizeUsd,
      recommendedPct,
      reasons: [
        ...reasons,
        `new opportunity +${config.reallocationScoreGap} vs weakest open position`,
        "recommend reducing weaker simulated position",
      ],
      reallocationTargetId: weakest.id,
      capViolation: true,
    };
  }

  let capViolation = false;
  if (wouldExceedDeployedCap(
    ctx.deployedCapital,
    recommendedSizeUsd,
    ctx.tradingBankroll,
    config,
  )) {
    capViolation = true;
    const headroom =
      ctx.tradingBankroll * config.maxDeployedPct - ctx.deployedCapital;
    if (headroom <= 0) {
      recommendedSizeUsd = 0;
      recommendedPct = 0;
      reasons.push("max deployed capital (80%) reached");
    } else {
      recommendedSizeUsd = Math.min(recommendedSizeUsd, headroom);
      recommendedPct = recommendedSizeUsd / ctx.tradingBankroll;
      reasons.push("size trimmed to deployed cap");
    }
  }

  if (recommendedSizeUsd <= 0) {
    if (duplicateMarket) {
      return reject(compositeScore, riskScore, reasons);
    }
    if (isMaxDeployed(ctx.deployedCapital, ctx.tradingBankroll, config)) {
      return watch(compositeScore, riskScore, [
        ...reasons,
        "deployed cap full — no room without reallocation",
      ]);
    }
    return reject(compositeScore, riskScore, reasons);
  }

  if (modPct < basePct * 0.99) {
    return finish("SCALE", compositeScore, riskScore, recommendedSizeUsd, recommendedPct, reasons, null, capViolation);
  }

  if (input.signalType === "RESEARCH" || compositeScore < 80) {
    return watch(compositeScore, riskScore, [...reasons, "research / sub-threshold — watch"]);
  }

  if (input.signalType === "WATCHLIST" && compositeScore < 88) {
    return watch(compositeScore, riskScore, [...reasons, "WATCHLIST — monitor before accept"]);
  }

  const openCount = ctx.openPositions.length;
  if (openCount >= config.preferredMaxPositions) {
    return watch(compositeScore, riskScore, [
      ...reasons,
      `preferred max open positions (${config.preferredMaxPositions})`,
    ]);
  }

  return finish(
    "ACCEPT",
    compositeScore,
    riskScore,
    recommendedSizeUsd,
    recommendedPct,
    reasons,
    null,
    capViolation,
  );
}

function finish(
  decision: PortfolioDecisionType,
  compositeScore: number,
  riskScore: number,
  recommendedSizeUsd: number,
  recommendedPct: number,
  reasons: string[],
  reallocationTargetId: string | null,
  capViolation: boolean,
): AllocationResult {
  return {
    decision,
    compositeScore,
    riskScore,
    recommendedSizeUsd,
    recommendedPct,
    reasons,
    reallocationTargetId,
    capViolation,
  };
}

function reject(
  compositeScore: number,
  riskScore: number,
  reasons: string[],
): AllocationResult {
  return finish("REJECT", compositeScore, riskScore, 0, 0, reasons, null, false);
}

function watch(
  compositeScore: number,
  riskScore: number,
  reasons: string[],
): AllocationResult {
  return finish("WATCH", compositeScore, riskScore, 0, 0, reasons, null, false);
}

export function summarizeDeployment(
  deployedCapital: number,
  tradingBankroll: number,
  largestPct: number,
): { deployedPct: number; largestPositionPct: number } {
  return {
    deployedPct: deployedPct(deployedCapital, tradingBankroll),
    largestPositionPct: largestPct,
  };
}
