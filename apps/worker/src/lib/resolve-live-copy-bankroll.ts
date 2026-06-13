import type { ExecutionProvider } from "@augurium/execution";
import { createExecutionProvider, getExecutionConfig, isPolymarketUsReady } from "@augurium/execution";

export type LiveCopyBankrollSource = "account" | "env" | "fallback";

export interface LiveCopyBankrollSnapshot {
  bankrollUsd: number;
  availableUsd: number;
  source: LiveCopyBankrollSource;
}

function envFallbackBankroll(): number {
  const raw =
    process.env.COPY_LIVE_BANKROLL_USD ?? process.env.COPY_PAPER_BANKROLL_USD ?? "200";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export async function resolveLiveCopyBankroll(
  provider?: ExecutionProvider,
): Promise<LiveCopyBankrollSnapshot> {
  const fallback = envFallbackBankroll();
  const useAccount = process.env.COPY_LIVE_USE_ACCOUNT_BALANCE !== "false";
  const cfg = getExecutionConfig();

  if (useAccount && cfg.provider === "polymarket-us" && isPolymarketUsReady()) {
    try {
      const exec = provider ?? createExecutionProvider();
      const balance = await exec.getBalance();
      const total = balance.totalUsd > 0 ? balance.totalUsd : balance.availableUsd;
      const available = balance.availableUsd > 0 ? balance.availableUsd : total;
      if (total > 0) {
        return { bankrollUsd: total, availableUsd: available, source: "account" };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[worker] live copy bankroll fetch failed: ${message}`);
    }
  }

  if (process.env.COPY_LIVE_BANKROLL_USD) {
    return { bankrollUsd: fallback, availableUsd: fallback, source: "env" };
  }

  return { bankrollUsd: fallback, availableUsd: fallback, source: "fallback" };
}
