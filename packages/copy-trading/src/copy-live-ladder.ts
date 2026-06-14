export interface CopyLiveLadderConfig {
  enabled: boolean;
  rung1LeaderRoi: number;
  rung1SellPctOfOriginal: number;
  rung2LeaderRoi: number;
  rung2SellPctOfOriginal: number;
}

export interface CopyLiveLadderStateView {
  rungsCompleted: number;
  remainingPct: number;
  originalSizeUsd: number;
}

export interface CopyLiveLadderAction {
  rung: 1 | 2;
  sellPctOfOriginal: number;
  sellUsd: number;
  leaderRoi: number;
}

export function getCopyLiveLadderConfig(): CopyLiveLadderConfig {
  const ladderOn = process.env.COPY_LIVE_LADDER_ENABLED !== "false";
  return {
    enabled: ladderOn,
    rung1LeaderRoi: Number(process.env.COPY_LIVE_LADDER_RUNG1_ROI ?? "0.15"),
    rung1SellPctOfOriginal: Number(process.env.COPY_LIVE_LADDER_RUNG1_SELL_PCT ?? "0.25"),
    rung2LeaderRoi: Number(process.env.COPY_LIVE_LADDER_RUNG2_ROI ?? "0.20"),
    rung2SellPctOfOriginal: Number(process.env.COPY_LIVE_LADDER_RUNG2_SELL_PCT ?? "0.50"),
  };
}

function readOriginalSizeUsd(metadata: unknown, fallback: number): number {
  if (!metadata || typeof metadata !== "object") return fallback;
  const raw = (metadata as { originalSizeUsd?: unknown }).originalSizeUsd;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Next partial sell from leader ROI and ladder progress (no double-sells). */
export function evaluateCopyLiveLadder(
  leaderRoi: number,
  ladder: CopyLiveLadderStateView,
  config: CopyLiveLadderConfig = getCopyLiveLadderConfig(),
): CopyLiveLadderAction | null {
  if (!config.enabled) return null;
  if (ladder.originalSizeUsd <= 0 || ladder.remainingPct <= 0.01) return null;

  if (ladder.rungsCompleted < 1 && leaderRoi >= config.rung1LeaderRoi) {
    const sellUsd = ladder.originalSizeUsd * config.rung1SellPctOfOriginal;
    if (sellUsd < 0.5) return null;
    return {
      rung: 1,
      sellPctOfOriginal: config.rung1SellPctOfOriginal,
      sellUsd,
      leaderRoi,
    };
  }

  if (ladder.rungsCompleted === 1 && leaderRoi >= config.rung2LeaderRoi) {
    const sellUsd = ladder.originalSizeUsd * config.rung2SellPctOfOriginal;
    if (sellUsd < 0.5) return null;
    return {
      rung: 2,
      sellPctOfOriginal: config.rung2SellPctOfOriginal,
      sellUsd,
      leaderRoi,
    };
  }

  return null;
}

export function ladderStateAfterRung(
  ladder: CopyLiveLadderStateView,
  action: CopyLiveLadderAction,
): { rungsCompleted: number; remainingPct: number; nextRungPct: number | null } {
  const remainingPct = Math.max(
    0,
    ladder.remainingPct - action.sellPctOfOriginal,
  );
  return {
    rungsCompleted: action.rung,
    remainingPct,
    nextRungPct: action.rung === 1 ? getCopyLiveLadderConfig().rung2LeaderRoi : null,
  };
}

export function viewLadderState(input: {
  rungsCompleted: number;
  remainingPct: number;
  metadata: unknown;
  requestedSizeUsd: number;
}): CopyLiveLadderStateView {
  return {
    rungsCompleted: input.rungsCompleted,
    remainingPct: input.remainingPct,
    originalSizeUsd: readOriginalSizeUsd(input.metadata, input.requestedSizeUsd),
  };
}
