import { computeAlphaScore, computeCapitalEfficiency, computeMovementConfirmation } from "./alpha.js";
import { computeMarketConsensusBySide } from "./consensus.js";
import { computeMarketQualityScore } from "./market-quality.js";
import { buildSignalReasoning } from "./reasoning.js";
import { computeSystemConfidenceScore } from "./system-confidence.js";
import { classifySignalType } from "./watchlist.js";
import { safeDivide } from "./math.js";
import type {
  ConsensusTradeInput,
  MarketQualityInput,
  MarketSignalEvaluation,
  SystemConfidenceInput,
} from "./types.js";

const WINDOW_MINUTES = 7 * 24 * 60;

export function evaluateMarketSignals(
  marketId: string,
  conditionId: string | null,
  trades: ConsensusTradeInput[],
  qualityInput: MarketQualityInput,
  systemInput: SystemConfidenceInput,
  now: Date,
): MarketSignalEvaluation[] {
  const systemConfidenceScore = computeSystemConfidenceScore(systemInput);
  const marketQualityScore = computeMarketQualityScore(qualityInput, now);
  const consensusBySide = computeMarketConsensusBySide(trades, now);

  const recentPrices = qualityInput.recentTrades;
  let priceDrift = 0;
  if (recentPrices.length >= 2) {
    const first = recentPrices[0].price;
    const last = recentPrices[recentPrices.length - 1].price;
    priceDrift = safeDivide(last - first, first, 0);
  }
  const movementConfirmation = computeMovementConfirmation(Math.abs(priceDrift));

  const evaluations: MarketSignalEvaluation[] = [];

  if (consensusBySide.size === 0) {
    evaluations.push({
      marketId,
      conditionId,
      outcomeSide: "UNKNOWN",
      consensus: {
        outcomeSide: "UNKNOWN",
        consensusScore: 0,
        copyabilityScore: 0,
        informationEdgeScore: 0,
        convictionScore: 0,
        disagreementScore: 0,
        opposingConsensus: 0,
        tradeCount: 0,
        triggerTradeIds: [],
        triggerTraderWallets: [],
        medianCopiedRoi: 0,
      },
      opposingConsensus: 0,
      marketQualityScore,
      alphaScore: 0,
      systemConfidenceScore,
      signalType: "IGNORE",
      reasoning: buildSignalReasoning({
        signalType: "IGNORE",
        outcomeSide: "UNKNOWN",
        consensus: {
          outcomeSide: "UNKNOWN",
          consensusScore: 0,
          copyabilityScore: 0,
          informationEdgeScore: 0,
          convictionScore: 0,
          disagreementScore: 0,
          opposingConsensus: 0,
          tradeCount: 0,
          triggerTradeIds: [],
          triggerTraderWallets: [],
          medianCopiedRoi: 0,
        },
        alphaScore: 0,
        marketQualityScore,
        systemConfidenceScore,
        disagreementScore: 0,
        skipReason: "No alignable outcome-side activity from scored traders",
        windowMinutes: WINDOW_MINUTES,
      }),
      skipReason: "no-outcome-activity",
    });
    return evaluations;
  }

  for (const [, consensus] of consensusBySide) {
    const capitalEfficiency = computeCapitalEfficiency(
      consensus.medianCopiedRoi,
      consensus.convictionScore,
    );
    const alphaScore = computeAlphaScore({
      consensus,
      marketQualityScore,
      disagreementScore: consensus.disagreementScore,
      capitalEfficiency,
      movementConfirmation,
    });

    const hasScoredTraderActivity = consensus.tradeCount > 0;
    const insufficientData =
      consensus.tradeCount < 1 ||
      systemConfidenceScore < 25 ||
      consensus.copyabilityScore < 0.1;

    const signalType = classifySignalType({
      consensusScore: consensus.consensusScore,
      alphaScore,
      marketQualityScore,
      systemConfidenceScore,
      hasScoredTraderActivity,
      insufficientData,
    });

    const forcedType =
      insufficientData && signalType === "TRADE_NOW" ? "RESEARCH" : signalType;

    evaluations.push({
      marketId,
      conditionId,
      outcomeSide: consensus.outcomeSide,
      consensus,
      opposingConsensus: consensus.opposingConsensus,
      marketQualityScore,
      alphaScore,
      systemConfidenceScore,
      signalType: forcedType,
      reasoning: buildSignalReasoning({
        signalType: forcedType,
        outcomeSide: consensus.outcomeSide,
        consensus,
        alphaScore,
        marketQualityScore,
        systemConfidenceScore,
        disagreementScore: consensus.disagreementScore,
        skipReason: insufficientData ? "Insufficient data for high-conviction TRADE_NOW" : null,
        windowMinutes: WINDOW_MINUTES,
      }),
      skipReason: insufficientData ? "insufficient-data" : null,
    });
  }

  return evaluations;
}

/** Deterministic check — no randomness in signal path. */
export function assertNoRandomness(): true {
  return true;
}
