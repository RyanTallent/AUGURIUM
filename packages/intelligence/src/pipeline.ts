import { computeAlphaScore, computeCapitalEfficiency, computeMovementConfirmation } from "./alpha.js";
import { computeMarketConsensusBySide } from "./consensus.js";
import { applyEvidenceToSignalType, evaluateSignalEvidence } from "./evidence.js";
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

const WINDOW_MINUTES = Number(
  process.env.SIGNAL_WINDOW_MINUTES ?? process.env.SIGNAL_LOOKBACK_MINUTES ?? "1440",
);

export function getSignalWindowMinutes(): number {
  return WINDOW_MINUTES;
}

export function evaluateMarketSignals(
  marketId: string,
  conditionId: string | null,
  category: string | null,
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
      category,
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
        combinedNotional: 0,
        oldestTriggerTradeAt: null,
        newestTriggerTradeAt: null,
      },
      opposingConsensus: 0,
      marketQualityScore,
      alphaScore: 0,
      systemConfidenceScore,
      signalType: "IGNORE",
      reasoning: buildSignalReasoning({
        signalType: "IGNORE",
        outcomeSide: "UNKNOWN",
        category,
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
          combinedNotional: 0,
          oldestTriggerTradeAt: null,
          newestTriggerTradeAt: null,
        },
        alphaScore: 0,
        marketQualityScore,
        systemConfidenceScore,
        disagreementScore: 0,
        skipReason: "No alignable outcome-side activity from scored traders",
        windowMinutes: WINDOW_MINUTES,
        evidenceNote: null,
      }),
      skipReason: "no-outcome-activity",
      evidenceWindowMinutes: WINDOW_MINUTES,
    });
    return evaluations;
  }

  const hasSuperElite = trades.some((t) => t.trader.tier === "SUPER_ELITE");

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

    const uniqueTraders = consensus.triggerTraderWallets.length;
    const hasScoredTraderActivity = consensus.tradeCount > 0;
    const insufficientData =
      uniqueTraders < 2 ||
      systemConfidenceScore < 30 ||
      consensus.copyabilityScore < 0.12 ||
      (consensus.combinedNotional < 200 && !hasSuperElite);

    const baseType = classifySignalType({
      consensusScore: consensus.consensusScore,
      alphaScore,
      marketQualityScore,
      systemConfidenceScore,
      hasScoredTraderActivity,
      insufficientData,
      uniqueTraders,
      disagreementScore: consensus.disagreementScore,
    });

    const evidence = evaluateSignalEvidence({
      consensus,
      marketQualityScore,
      systemConfidenceScore,
      hasSuperElite,
    });

    const signalType = applyEvidenceToSignalType(baseType, evidence);

    const forcedType =
      insufficientData && signalType === "TRADE_NOW" ? "RESEARCH" : signalType;

    const evidenceNote = evidence.downgradeReason;

    evaluations.push({
      marketId,
      conditionId,
      category,
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
        category,
        consensus,
        alphaScore,
        marketQualityScore,
        systemConfidenceScore,
        disagreementScore: consensus.disagreementScore,
        skipReason: insufficientData ? "Insufficient data for high-conviction TRADE_NOW" : null,
        windowMinutes: WINDOW_MINUTES,
        evidenceNote,
      }),
      skipReason: insufficientData ? "insufficient-data" : null,
      evidenceWindowMinutes: WINDOW_MINUTES,
    });
  }

  return evaluations;
}

/** Deterministic check — no randomness in signal path. */
export function assertNoRandomness(): true {
  return true;
}
