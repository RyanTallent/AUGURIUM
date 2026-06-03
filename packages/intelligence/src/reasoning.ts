import type { SignalType } from "./types.js";
import type { SideConsensusResult } from "./types.js";

export interface ReasoningInput {
  signalType: SignalType;
  outcomeSide: string;
  category: string | null;
  consensus: SideConsensusResult;
  alphaScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  disagreementScore: number;
  skipReason: string | null;
  windowMinutes: number;
  evidenceNote: string | null;
}

function formatRecency(oldest: Date | null, newest: Date | null): string {
  if (!newest) return "recency unknown";
  const ageMin = oldest
    ? Math.round((newest.getTime() - oldest.getTime()) / 60000)
    : 0;
  return oldest
    ? `trades span ~${ageMin}m (newest ${newest.toISOString()})`
    : `newest trade ${newest.toISOString()}`;
}

export function buildSignalReasoning(input: ReasoningInput): string {
  if (input.skipReason) {
    return `${input.signalType} — ${input.skipReason}`;
  }

  const c = input.consensus;
  const traders = c.triggerTraderWallets.length;
  const notional = c.combinedNotional ?? 0;
  const cat = input.category ?? "Other";
  const walletSample =
    c.triggerTraderWallets.length > 0
      ? ` (${c.triggerTraderWallets.slice(0, 3).join(", ")})`
      : "";
  const disagreement =
    input.disagreementScore > 0.45 ? "high" : input.disagreementScore > 0.25 ? "moderate" : "low";

  const copiedPct = (c.medianCopiedRoi * 100).toFixed(1);
  const recency = formatRecency(c.oldestTriggerTradeAt, c.newestTriggerTradeAt);

  let gateNote = "";
  if (input.signalType === "RESEARCH" || input.signalType === "IGNORE") {
    gateNote = " Not WATCHLIST/TRADE_NOW: ";
    if (traders < 3) gateNote += "too few independent scored traders; ";
    if (notional < 500) gateNote += "combined notional too low; ";
    if (input.systemConfidenceScore < 50) gateNote += "system confidence weak; ";
    if (input.disagreementScore >= 0.4) gateNote += "material disagreement; ";
    gateNote = gateNote.trimEnd();
  }

  const evidence = input.evidenceNote ? ` ${input.evidenceNote}.` : "";

  return (
    `${input.signalType} [${cat}]: ${traders} scored trader(s)${walletSample}, $${notional.toFixed(0)} notional, ` +
    `${recency}, window ~${input.windowMinutes}m; consensus ${c.consensusScore.toFixed(0)}, ` +
    `alpha ${input.alphaScore.toFixed(0)}, copied ROI median ${copiedPct}%, ` +
    `market quality ${input.marketQualityScore.toFixed(0)}, system ${input.systemConfidenceScore.toFixed(0)}, ` +
    `disagreement ${disagreement}.${gateNote}${evidence}`
  );
}
