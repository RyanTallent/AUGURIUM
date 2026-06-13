import { getExecutionConfig, isLivePolymarketEnabled, isPaperExecutionEnabled } from "./config.js";
import type { GateCheckInput, GateCheckResult } from "./types.js";

export function evaluateExecutionGates(input: GateCheckInput): GateCheckResult {
  const cfg = getExecutionConfig();
  const reasons: string[] = [];

  if (!cfg.executionEnabled) {
    reasons.push("EXECUTION_ENABLED is false");
  }

  if (cfg.provider === "paper" && !isPaperExecutionEnabled(cfg)) {
    reasons.push("paper execution not enabled");
  }

  if (cfg.provider === "polymarket" || cfg.provider === "polymarket-us") {
    if (!isLivePolymarketEnabled(cfg)) {
      reasons.push("live Polymarket requires LIVE_TRADING_ENABLED and ALLOW_REAL_MONEY");
    }
    if (!input.credentialsValid) {
      reasons.push("Polymarket credentials not validated");
    }
  }

  if (input.signalType !== "TRADE_NOW") {
    reasons.push(`signal type ${input.signalType} is not TRADE_NOW`);
  }

  if (input.portfolioDecision !== "ACCEPT") {
    reasons.push(`portfolio decision ${input.portfolioDecision} is not ACCEPT`);
  }

  if (input.hasMockSignal) {
    reasons.push("mock/random signal detected");
  }

  if (!input.marketActive || input.marketClosed) {
    reasons.push("market not open/active");
  }

  if (!input.reconciliationOk) {
    reasons.push("reconciliation mismatch — new orders blocked");
  }

  if (input.duplicateSignalOrder) {
    reasons.push("duplicate order for signal");
  }

  if (input.duplicateMarketSide) {
    reasons.push("duplicate open position for market+side");
  }

  if (input.conflictingOppositeSide) {
    reasons.push("conflicting YES/NO position on same market");
  }

  if (input.slippageBps > input.maxSlippageBps) {
    reasons.push(`slippage ${input.slippageBps}bps exceeds max ${input.maxSlippageBps}bps`);
  }

  if (input.deployedPct > input.maxDeployedPct + 0.001) {
    reasons.push("max deployed capital exceeded");
  }

  if (input.positionPct > input.maxPositionPct + 0.001) {
    reasons.push("single position cap exceeded");
  }

  if (input.dailyLossUsd >= input.maxDailyLossUsd) {
    reasons.push("daily loss cap reached");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function executionModeLabel(cfg = getExecutionConfig()): string {
  if (!cfg.executionEnabled) return "DISABLED";
  if (cfg.provider === "paper") return "PAPER";
  if (cfg.provider === "replay") return "REPLAY";
  if (cfg.provider === "polymarket-us" && isLivePolymarketEnabled(cfg)) return "LIVE_US";
  if (isLivePolymarketEnabled(cfg)) return "LIVE";
  return "BLOCKED";
}
