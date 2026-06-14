import { prisma } from "@augurium/database";
import { usePolymarketScanIntel } from "@augurium/shared";
import {
  applyRiskToDecision,
  buildTraderTruth,
  decideCopyTrader,
  evaluateCopyV1LeaderGate,
} from "@augurium/copy-trading";
import { scoreTraderUsLiveCompat, usLeaderCompatRequired, maxFullGateLeaders } from "./us-leader-compat.js";
import { notifyBrainLeaderChange } from "./enqueue-live-copy-discord.js";

export function copyCandidatePoolSize(): number {
  const raw =
    process.env.COPY_LIVE_CANDIDATE_POOL ??
    process.env.COPY_CANDIDATE_POOL ??
    "500";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function copyMaxLeaders(): number {
  const raw = process.env.COPY_LIVE_MAX_LEADERS ?? process.env.COPY_MAX_LEADERS ?? "15";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

export function copyMinLeaders(): number {
  const raw = process.env.COPY_LIVE_MIN_LEADERS ?? "5";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** Keep CopyTraderControl in sync with v1 scoring gates. */
export async function refreshCopyTraderControls(): Promise<{
  evaluated: number;
  copyEnabled: number;
}> {
  const pool = copyCandidatePoolSize();
  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  let copyEnabled = 0;
  const promoted: string[] = [];
  const cooled: string[] = [];

  for (const t of traders) {
    const snap = t.metricsSnapshots[0] ?? null;
    const truth = buildTraderTruth(t, snap);
    const legacy = applyRiskToDecision(decideCopyTrader(truth), truth);

    let usMatch = 0;
    if (usLeaderCompatRequired() || usePolymarketScanIntel()) {
      const compat = await scoreTraderUsLiveCompat(t.id, t.address);
      usMatch = compat.bestConfidence;
    }

    const v1 = evaluateCopyV1LeaderGate({ truth, usMatchConfidence: usMatch });
    const enabled = v1.pass && legacy.recommendation !== "AVOID";
    if (enabled) copyEnabled++;

    const prior = await prisma.copyTraderControl.findUnique({
      where: { traderId: t.id },
      select: { enabled: true },
    });
    if (prior && !prior.enabled && enabled) promoted.push(t.address);
    if (prior?.enabled && !enabled) cooled.push(t.address);

    const strengths = [
      ...legacy.strengths,
      `v1 L${v1.scores.lifetime.toFixed(0)} H${v1.scores.heat.toFixed(0)} C${v1.scores.conviction.toFixed(0)}`,
    ];
    const weaknesses =
      v1.reasons.length > 0 ? v1.reasons : legacy.weaknesses;

    await prisma.copyTraderControl.upsert({
      where: { traderId: t.id },
      create: {
        traderId: t.id,
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: v1.scores.conviction,
        riskScore: v1.scores.uncertainty,
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "v1 gate failed",
        strengths,
        weaknesses,
      },
      update: {
        copyDecision: enabled ? "COPY" : legacy.recommendation,
        copyScore: v1.scores.conviction,
        riskScore: v1.scores.uncertainty,
        expectedValue: legacy.expectedValue,
        enabled,
        disabledReason: enabled ? null : weaknesses[0] ?? "v1 gate failed",
        strengths,
        weaknesses,
        evaluatedAt: new Date(),
      },
    });
  }

  if (promoted.length > 0 || cooled.length > 0) {
    await notifyBrainLeaderChange({ promoted, cooled, copyEnabled });
  }

  if (traders.length > 0) {
    console.log(
      `[worker] copy trader controls refreshed pool=${pool} evaluated=${traders.length} copyEnabled=${copyEnabled}`,
    );
  }

  return { evaluated: traders.length, copyEnabled };
}

export async function loadTopCopyLeaderIds(): Promise<string[]> {
  const maxLeaders = copyMaxLeaders();
  const minLeaders = copyMinLeaders();

  const rows = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: [{ copyScore: "desc" }, { evaluatedAt: "desc" }],
    take: Math.max(maxLeaders, minLeaders, 20),
    include: { trader: { select: { id: true, address: true } } },
  });

  if (!usLeaderCompatRequired() || rows.length === 0) {
    return rows.slice(0, maxLeaders).map((r) => r.traderId);
  }

  const scored = await Promise.all(
    rows.slice(0, maxFullGateLeaders()).map(async (row) => {
      const compat = await scoreTraderUsLiveCompat(row.trader.id, row.trader.address);
      return { traderId: row.traderId, copyScore: row.copyScore, compat };
    }),
  );

  const tradeable = scored
    .filter((r) => r.compat.hasTradeableUsPosition && r.compat.bestConfidence >= 0.9)
    .sort(
      (a, b) =>
        b.compat.bestConfidence - a.compat.bestConfidence ||
        b.copyScore - a.copyScore,
    );

  if (tradeable.length >= minLeaders) {
    return tradeable.slice(0, maxLeaders).map((r) => r.traderId);
  }

  if (tradeable.length > 0) {
    return tradeable.slice(0, maxLeaders).map((r) => r.traderId);
  }

  return rows.slice(0, Math.min(maxLeaders, minLeaders)).map((r) => r.traderId);
}
