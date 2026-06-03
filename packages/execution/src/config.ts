import type { ExecutionProviderName } from "./types.js";

export interface ExecutionConfig {
  executionEnabled: boolean;
  provider: ExecutionProviderName;
  liveTradingEnabled: boolean;
  allowRealMoney: boolean;
  maxSlippageBps: number;
  polygonChainId: number;
  hasPrivateKey: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasApiPassphrase: boolean;
  hasFunderAddress: boolean;
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

export function getExecutionConfig(): ExecutionConfig {
  const provider = (process.env.EXECUTION_PROVIDER ?? "paper").toLowerCase() as ExecutionProviderName;
  const normalized: ExecutionProviderName =
    provider === "polymarket" || provider === "replay" ? provider : "paper";

  return {
    executionEnabled: envFlag("EXECUTION_ENABLED"),
    provider: normalized,
    liveTradingEnabled: envFlag("LIVE_TRADING_ENABLED"),
    allowRealMoney: envFlag("ALLOW_REAL_MONEY"),
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS ?? "100"),
    polygonChainId: 137,
    hasPrivateKey: Boolean(process.env.POLYMARKET_PRIVATE_KEY?.trim()),
    hasApiKey: Boolean(process.env.POLYMARKET_API_KEY?.trim()),
    hasApiSecret: Boolean(process.env.POLYMARKET_API_SECRET?.trim()),
    hasApiPassphrase: Boolean(process.env.POLYMARKET_API_PASSPHRASE?.trim()),
    hasFunderAddress: Boolean(process.env.POLYMARKET_FUNDER_ADDRESS?.trim()),
  };
}

/** Live Polymarket orders only when every gate env is explicitly enabled. */
export function isLivePolymarketEnabled(cfg: ExecutionConfig): boolean {
  return (
    cfg.executionEnabled &&
    cfg.provider === "polymarket" &&
    cfg.liveTradingEnabled &&
    cfg.allowRealMoney
  );
}

export function isPaperExecutionEnabled(cfg: ExecutionConfig): boolean {
  return cfg.executionEnabled && cfg.provider === "paper";
}

export function isReplayExecutionEnabled(cfg: ExecutionConfig): boolean {
  return cfg.executionEnabled && cfg.provider === "replay";
}
