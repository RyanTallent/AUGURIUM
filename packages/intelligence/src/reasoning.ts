import type { SignalType } from "./types.js";
import type { SideConsensusResult } from "./types.js";

export interface ReasoningInput {
  signalType: SignalType;
  outcomeSide: string;
  consensus: SideConsensusResult;
  alphaScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  disagreementScore: number;
  skipReason: string | null;
  windowMinutes: number;
}

export function buildSignalReasoning(input: ReasoningInput): string {
  if (input.skipReason) {
    return `${input.signalType} — ${input.skipReason}`;
  }

  const c = input.consensus;
  const traders = c.triggerTraderWallets.length;
  const walletSample =
    c.triggerTraderWallets.length > 0
      ? ` (${c.triggerTraderWallets.slice(0, 3).join(", ")})`
      : "";
  const disagreement =
    input.disagreementScore > 0.45 ? "high" : input.disagreementScore > 0.25 ? "moderate" : "low";

  const copiedPct = (c.medianCopiedRoi * 100).toFixed(1);

  return (
    `${input.signalType} because ${traders} high-copyability scored trader(s)${walletSample} entered ${input.outcomeSide} ` +
    `within ~${input.windowMinutes}m window; weighted consensus ${c.consensusScore.toFixed(0)}, ` +
    `alpha ${input.alphaScore.toFixed(0)}, copied ROI median ${copiedPct}%, ` +
    `market quality ${input.marketQualityScore.toFixed(0)}, ` +
    `system confidence ${input.systemConfidenceScore.toFixed(0)}, disagreement ${disagreement}.`
  );
}
