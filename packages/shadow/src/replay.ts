import type { ReplayPayload } from "./types.js";

export function buildReplayPayload(data: {
  capturedAt: Date;
  signal: Record<string, unknown>;
  market: Record<string, unknown>;
  recentTrades: Record<string, unknown>[];
  triggerTraders: Record<string, unknown>[];
  simulatedSizeUsd: number;
  entryDelayMs: number;
  entryDelayLabel: string;
  reasoning: string;
}): ReplayPayload {
  const scores = {
    consensusScore: Number(data.signal.consensusScore ?? 0),
    alphaScore: Number(data.signal.alphaScore ?? 0),
    marketQualityScore: Number(data.signal.marketQualityScore ?? 0),
    systemConfidenceScore: Number(data.signal.systemConfidenceScore ?? 0),
    copyabilityScore: Number(data.signal.copyabilityScore ?? 0),
    informationEdgeScore: Number(data.signal.informationEdgeScore ?? 0),
  };

  return {
    capturedAt: data.capturedAt.toISOString(),
    signal: data.signal,
    market: data.market,
    recentTrades: data.recentTrades,
    triggerTraders: data.triggerTraders,
    portfolioAssumption: {
      simulatedSizeUsd: data.simulatedSizeUsd,
      entryDelayMs: data.entryDelayMs,
      entryDelayLabel: data.entryDelayLabel,
    },
    scores,
    reasoning: data.reasoning,
  };
}

export function validateReplayPayload(payload: ReplayPayload): boolean {
  return (
    typeof payload.capturedAt === "string" &&
    typeof payload.reasoning === "string" &&
    payload.signal != null &&
    payload.market != null &&
    Array.isArray(payload.recentTrades) &&
    Array.isArray(payload.triggerTraders) &&
    payload.portfolioAssumption != null
  );
}
