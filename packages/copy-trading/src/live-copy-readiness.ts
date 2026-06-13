import { computeLiveTradingReadiness, prisma } from "@augurium/database";
import {
  getExecutionConfig,
  isLivePolymarketEnabled,
  isPolymarketUsReady,
  executionModeLabel,
} from "@augurium/execution";
import { computeCopyBoard } from "./compute-copy-board.js";

export interface LiveCopyReadinessReport {
  ready: boolean;
  executionMode: string;
  liveGatesEnabled: boolean;
  credentialsConfigured: boolean;
  clobImplementationReady: boolean;
  systemReadinessPass: boolean;
  copyTargetsToday: number;
  openLiveMirrors: number;
  blockers: string[];
  enableChecklist: string[];
  generatedAt: string;
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

/** True when Polymarket Global CLOB client is wired. */
export function isPolymarketClobReady(): boolean {
  return envFlag("POLYMARKET_CLOB_READY");
}

export function isLiveCopySkipSystemReadiness(): boolean {
  return envFlag("LIVE_COPY_SKIP_SYSTEM_READINESS");
}

function isUsProvider(provider: string): boolean {
  return provider === "polymarket-us";
}

export async function computeLiveCopyReadiness(): Promise<LiveCopyReadinessReport> {
  const cfg = getExecutionConfig();
  const us = isUsProvider(cfg.provider);
  const [system, board, openLiveMirrors] = await Promise.all([
    computeLiveTradingReadiness(),
    computeCopyBoard(30),
    prisma.copyLiveMirror.count({ where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } } }),
  ]);

  const credentialsConfigured = us
    ? cfg.hasUsKeyId && cfg.hasUsSecretKey
    : cfg.hasPrivateKey &&
      cfg.hasFunderAddress &&
      ((cfg.hasApiKey && cfg.hasApiSecret && cfg.hasApiPassphrase) || isPolymarketClobReady());

  const liveGatesEnabled = isLivePolymarketEnabled(cfg);
  const clobImplementationReady = us ? isPolymarketUsReady() : isPolymarketClobReady();
  const copyTargetsToday = board.topTradersToday.length;

  const blockers: string[] = [];
  if (!cfg.executionEnabled) blockers.push("EXECUTION_ENABLED is false");
  if (process.env.LIVE_COPY_ENABLED === "true" && cfg.provider !== "polymarket-us") {
    blockers.push(
      `LIVE_COPY requires EXECUTION_PROVIDER=polymarket-us (current: ${cfg.provider})`,
    );
  } else if (cfg.provider !== "polymarket" && cfg.provider !== "polymarket-us") {
    blockers.push(`EXECUTION_PROVIDER must be polymarket or polymarket-us (current: ${cfg.provider})`);
  }
  if (!liveGatesEnabled) {
    blockers.push("LIVE_TRADING_ENABLED and ALLOW_REAL_MONEY must both be true");
  }
  if (!credentialsConfigured) {
    blockers.push(
      us
        ? "Polymarket US API keys missing (POLYMARKET_US_KEY_ID, POLYMARKET_US_SECRET_KEY)"
        : "Polymarket API credentials incomplete in Render env group",
    );
  }
  if (!clobImplementationReady) {
    blockers.push(
      us
        ? "POLYMARKET_US_READY is false — US order placement not enabled"
        : "POLYMARKET_CLOB_READY is false — CLOB order placement not enabled in code",
    );
  }
  const skipSystemReadiness = envFlag("LIVE_COPY_SKIP_SYSTEM_READINESS");
  if (!skipSystemReadiness && !system.liveTradingReady) {
    blockers.push("System readiness failed (shadow/paper/data gates)");
    blockers.push(...system.blockers.slice(0, 5));
  }
  if (copyTargetsToday === 0) {
    blockers.push("No traders meet COPY criteria today");
  }

  const enableChecklist = us
    ? [
        "1. Complete KYC in Polymarket US iOS app (same login as developer portal)",
        "2. Generate Ed25519 API keys at polymarket.us/developer (secret shown once)",
        "3. Set POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY on augurium-worker",
        "4. Set EXECUTION_PROVIDER=polymarket-us, EXECUTION_ENABLED=true",
        "5. Set LIVE_TRADING_ENABLED=true and ALLOW_REAL_MONEY=true",
        "6. Set POLYMARKET_US_READY=true",
        "7. Set LIVE_COPY_ENABLED=true and monitor worker logs",
      ]
    : [
        "1. Run recovery + maintenance on production DB (impossible PnL = 0, shadow trust OK)",
        "2. Confirm /readiness shows LIVE TRADING READY = YES",
        "3. Set Polymarket secrets on worker: PRIVATE_KEY and FUNDER_ADDRESS (API trio optional — derived from private key)",
        "4. Set EXECUTION_ENABLED=true, EXECUTION_PROVIDER=polymarket",
        "5. Set LIVE_TRADING_ENABLED=true and ALLOW_REAL_MONEY=true (worker only, after review)",
        "6. Set POLYMARKET_CLOB_READY=true only after @polymarket/clob-client is wired",
        "7. Set LIVE_COPY_ENABLED=true on worker to mirror COPY positions",
        "8. Start with small COPY_PAPER_BANKROLL_USD / per-trader caps; monitor /copy and execution recon",
      ];

  const ready =
    blockers.length === 0 &&
    (skipSystemReadiness || system.liveTradingReady) &&
    liveGatesEnabled &&
    credentialsConfigured &&
    clobImplementationReady &&
    copyTargetsToday > 0;

  return {
    ready,
    executionMode: executionModeLabel(cfg),
    liveGatesEnabled,
    credentialsConfigured,
    clobImplementationReady,
    systemReadinessPass: system.liveTradingReady,
    copyTargetsToday,
    openLiveMirrors,
    blockers,
    enableChecklist,
    generatedAt: new Date().toISOString(),
  };
}
