import { clamp, median, safeDivide } from "./math.js";
import { recencyWeight } from "./recency.js";
import { supportedOutcomeSide } from "./outcome-side.js";
import { tierWeight } from "./tier-weight.js";
import type { ConsensusTradeInput, SideConsensusResult } from "./types.js";

function tradeContribution(
  trade: ConsensusTradeInput,
  notionalMedian: number,
  now: Date,
): number {
  const t = trade.trader;
  const traderQuality = clamp(t.rankingScore / 100, 0, 1);
  const copyability = clamp(t.copyabilityScore, 0, 1);
  const edge = clamp(t.informationEdgeScore, 0, 1);
  const confidence = clamp(t.confidenceScore, 0, 1);
  const recentForm = clamp(t.recentFormScore, 0, 1);

  const notional = trade.size * trade.price;
  const convictionRaw = safeDivide(notional, notionalMedian, 0.5);
  const conviction = clamp(convictionRaw, 0.2, 2);

  const recency = recencyWeight(trade.tradedAt, now);
  const tier = tierWeight(t.tier);
  const lowConfPenalty = t.lowConfidence ? 0.65 : 1;

  const base =
    traderQuality * 0.3 +
    copyability * 0.2 +
    edge * 0.15 +
    conviction * 0.15 +
    confidence * 0.1 +
    recentForm * 0.1;

  return base * recency * tier * lowConfPenalty * notional;
}

export function computeDisagreementScore(
  sideScore: number,
  opposingScore: number,
): number {
  const total = sideScore + opposingScore;
  if (total <= 0) return 0;
  const balance = Math.abs(sideScore - opposingScore) / total;
  return clamp(1 - balance, 0, 1);
}

export function computeSideConsensus(
  outcomeSide: string,
  trades: ConsensusTradeInput[],
  now: Date,
): SideConsensusResult {
  const sideTrades = trades.filter((t) => supportedOutcomeSide(t) === outcomeSide);

  if (sideTrades.length === 0) {
    return {
      outcomeSide,
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
    };
  }

  const notionals = sideTrades.map((t) => t.size * t.price);
  const combinedNotional = notionals.reduce((a, b) => a + b, 0);
  const tradeTimes = sideTrades.map((t) => t.tradedAt.getTime());
  const notionalMedian = median(notionals) || 1;

  let weightSum = 0;
  let scoreSum = 0;
  let copySum = 0;
  let edgeSum = 0;
  let convSum = 0;
  const copiedRois: number[] = [];
  const wallets = new Set<string>();

  for (const trade of sideTrades) {
    const w = tradeContribution(trade, notionalMedian, now);
    const t = trade.trader;
    weightSum += w;
    scoreSum += w * clamp(t.rankingScore / 100, 0, 1);
    copySum += w * t.copyabilityScore;
    edgeSum += w * t.informationEdgeScore;
    convSum += w * safeDivide(trade.size * trade.price, notionalMedian, 0.5);
    copiedRois.push(t.estimatedCopiedRoi);
    wallets.add(trade.wallet);
  }

  const consensusScore = clamp((scoreSum / Math.max(weightSum, 1e-9)) * 100, 0, 100);

  return {
    outcomeSide,
    consensusScore,
    copyabilityScore: clamp(copySum / Math.max(weightSum, 1e-9), 0, 1),
    informationEdgeScore: clamp(edgeSum / Math.max(weightSum, 1e-9), 0, 1),
    convictionScore: clamp(convSum / Math.max(weightSum, 1e-9), 0, 1),
    disagreementScore: 0,
    opposingConsensus: 0,
    tradeCount: sideTrades.length,
    triggerTradeIds: sideTrades.map((t) => t.tradeId),
    triggerTraderWallets: [...wallets],
    medianCopiedRoi: median(copiedRois),
    combinedNotional,
    oldestTriggerTradeAt: new Date(Math.min(...tradeTimes)),
    newestTriggerTradeAt: new Date(Math.max(...tradeTimes)),
  };
}

export function computeMarketConsensusBySide(
  trades: ConsensusTradeInput[],
  now: Date,
): Map<string, SideConsensusResult> {
  const sides = new Set<string>();
  for (const t of trades) {
    const side = supportedOutcomeSide(t);
    if (side) sides.add(side);
  }

  const results = new Map<string, SideConsensusResult>();
  for (const outcomeSide of sides) {
    results.set(outcomeSide, computeSideConsensus(outcomeSide, trades, now));
  }

  for (const [outcomeSide, result] of results) {
    const opposingConsensus = Math.max(
      0,
      ...[...results.entries()]
        .filter(([s]) => s !== outcomeSide)
        .map(([, r]) => r.consensusScore),
    );
    result.opposingConsensus = opposingConsensus;
    result.disagreementScore = computeDisagreementScore(
      result.consensusScore,
      opposingConsensus,
    );
  }

  return results;
}
