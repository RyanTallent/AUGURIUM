function readPctEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface LiveCopySizingConfig {
  positionPct: number;
  maxDeployedPct: number;
  minTradeUsd: number;
}

export function getLiveCopySizingConfig(): LiveCopySizingConfig {
  return {
    positionPct: readPctEnv("COPY_LIVE_POSITION_PCT", 0.15),
    maxDeployedPct: readPctEnv("COPY_LIVE_MAX_DEPLOYED_PCT", 0.5),
    minTradeUsd: Number(process.env.COPY_LIVE_MIN_TRADE_USD ?? "5"),
  };
}

export function sumOpenExposureUsd(rows: Array<{ usd: number }>): number {
  return rows.reduce((sum, row) => sum + row.usd, 0);
}

/** Next trade size: up to positionPct of equity, within maxDeployedPct room and buying power. */
export function computeLiveTradeSizeUsd(
  bankrollUsd: number,
  deployedUsd: number,
  config: LiveCopySizingConfig = getLiveCopySizingConfig(),
  availableUsd?: number,
): number {
  if (bankrollUsd <= 0) return 0;

  const maxDeployUsd = bankrollUsd * config.maxDeployedPct;
  const deployRoom = Math.max(0, maxDeployUsd - deployedUsd);
  let sizeUsd = Math.min(bankrollUsd * config.positionPct, deployRoom);

  if (availableUsd != null && availableUsd > 0) {
    sizeUsd = Math.min(sizeUsd, availableUsd);
  }

  const rounded = Math.round(sizeUsd * 100) / 100;
  if (rounded < config.minTradeUsd) return 0;
  return rounded;
}

export function canAddDeployedExposure(
  bankrollUsd: number,
  deployedUsd: number,
  candidateUsd: number,
  maxDeployedPct = getLiveCopySizingConfig().maxDeployedPct,
): { allowed: boolean; reason: string | null } {
  if (bankrollUsd <= 0) {
    return { allowed: false, reason: "account balance unavailable" };
  }
  const capUsd = bankrollUsd * maxDeployedPct;
  if (deployedUsd + candidateUsd > capUsd + 0.01) {
    return {
      allowed: false,
      reason: `deployed exposure would exceed ${(maxDeployedPct * 100).toFixed(0)}% of account ($${capUsd.toFixed(0)} cap)`,
    };
  }
  return { allowed: true, reason: null };
}
