import { prisma } from "@augurium/database";
import { usePolymarketScanIntel } from "@augurium/shared";
import {
  applyRiskToDecision,
  buildTraderTruth,
  copyEfficiencyScore,
  decideCopyTrader,
} from "@augurium/copy-trading";
import { scoreTraderUsLiveCompat, usLeaderCompatRequired, maxFullGateLeaders } from "./us-leader-compat.js";

export function copyCandidatePoolSize(): number {
  const raw =
    process.env.COPY_LIVE_CANDIDATE_POOL ??
    process.env.COPY_CANDIDATE_POOL ??
    "500";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function copyMaxLeaders(): number {
  const raw = process.env.COPY_LIVE_MAX_LEADERS ?? process.env.COPY_MAX_LEADERS ?? "80";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 80;
}

/** Keep CopyTraderControl in sync for live copy (even when paper copy is off). */
export async function refreshCopyTraderControls(): Promise<{
  evaluated: number;
  copyEnabled: number;
}> {
  if (usePolymarketScanIntel()) {
    const [evaluated, copyEnabled] = await Promise.all([
      prisma.copyTraderControl.count(),
      prisma.copyTraderControl.count({ where: { enabled: true } }),
    ]);
    console.log(
      `[worker] copy trader controls (PolymarketScan) evaluated=${evaluated} copyEnabled=${copyEnabled}`,
    );
    return { evaluated, copyEnabled };
  }

  const pool = copyCandidatePoolSize();
  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  let copyEnabled = 0;
  for (const t of traders) {
    const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
    const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
    const enabled = decision.recommendation === "COPY";
    if (enabled) copyEnabled++;

    await prisma.copyTraderControl.upsert({
      where: { traderId: t.id },
      create: {
        traderId: t.id,
        copyDecision: decision.recommendation,
        copyScore: decision.copyScore,
        riskScore: decision.riskScore,
        expectedValue: decision.expectedValue,
        enabled,
        disabledReason: enabled ? null : decision.weaknesses[0] ?? "not COPY",
        strengths: decision.strengths,
        weaknesses: decision.weaknesses,
      },
      update: {
        copyDecision: decision.recommendation,
        copyScore: decision.copyScore,
        riskScore: decision.riskScore,
        expectedValue: decision.expectedValue,
        enabled,
        disabledReason: enabled ? null : decision.weaknesses[0] ?? "not COPY",
        strengths: decision.strengths,
        weaknesses: decision.weaknesses,
        evaluatedAt: new Date(),
      },
    });
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

  if (usePolymarketScanIntel()) {
    const rows = await prisma.copyTraderControl.findMany({
      where: { enabled: true },
      orderBy: [{ copyScore: "desc" }, { evaluatedAt: "desc" }],
      take: Math.max(maxLeaders, 20),
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
      .filter((r) => r.compat.hasTradeableUsPosition)
      .sort(
        (a, b) =>
          b.compat.usCompatible - a.compat.usCompatible ||
          b.compat.bestConfidence - a.compat.bestConfidence ||
          b.copyScore - a.copyScore,
      );

    if (tradeable.length > 0) {
      console.log(
        `[worker] US-compat leaders: ${tradeable.length} with tradeable positions (top=${tradeable[0]?.traderId.slice(0, 10)}…)`,
      );
      return tradeable.slice(0, maxLeaders).map((r) => r.traderId);
    }

    console.warn(
      `[worker] no enabled leaders with US-compatible open positions — ${scored.length} enabled leader(s) skipped for live copy`,
    );
    return [];
  }

  const pool = copyCandidatePoolSize();

  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: pool,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  return traders
    .map((t) => {
      const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
      const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
      const efficiency = copyEfficiencyScore(truth, decision);
      return { traderId: t.id, decision, efficiency };
    })
    .filter((r) => r.decision.recommendation === "COPY")
    .sort((a, b) => b.efficiency - a.efficiency)
    .slice(0, maxLeaders)
    .map((r) => r.traderId);
}
