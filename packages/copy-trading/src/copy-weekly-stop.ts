import { prisma } from "@augurium/database";

const DEFAULT_BANKROLL = Number(process.env.COPY_PAPER_BANKROLL_USD ?? "10000");
const MAX_WEEKLY_LOSS_PCT = Number(process.env.COPY_WEEKLY_MAX_LOSS_PCT ?? "0.2");

export interface CopyWeeklyRiskStatus {
  weekKey: string;
  bankrollUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  lossPct: number;
  maxLossPct: number;
  halted: boolean;
  haltedReason: string | null;
  canOpenNewMirrors: boolean;
}

/** ISO-like week key (Monday UTC week). */
export function currentCopyWeekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekStartUtc(weekKey: string): Date {
  const [y, w] = weekKey.split("-W");
  const year = Number(y);
  const week = Number(w);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

async function sumWeeklyCopyPnl(weekKey: string): Promise<{
  realized: number;
  unrealized: number;
}> {
  const start = weekStartUtc(weekKey);
  const [closed, open] = await Promise.all([
    prisma.copyPaperPosition.aggregate({
      where: { status: "CLOSED", closedAt: { gte: start } },
      _sum: { realizedPnl: true },
    }),
    prisma.copyPaperPosition.aggregate({
      where: { status: "OPEN" },
      _sum: { unrealizedPnl: true },
    }),
  ]);
  return {
    realized: closed._sum.realizedPnl ?? 0,
    unrealized: open._sum.unrealizedPnl ?? 0,
  };
}

export async function evaluateCopyWeeklyStopLoss(
  bankrollUsd = DEFAULT_BANKROLL,
): Promise<CopyWeeklyRiskStatus> {
  const weekKey = currentCopyWeekKey();
  const maxLossPct = MAX_WEEKLY_LOSS_PCT;
  const { realized, unrealized } = await sumWeeklyCopyPnl(weekKey);
  const totalPnlUsd = realized + unrealized;
  const lossPct =
    totalPnlUsd < 0 && bankrollUsd > 0 ? Math.min(1, -totalPnlUsd / bankrollUsd) : 0;

  const existing = await prisma.copyWeeklyRiskState.findUnique({
    where: { id: "current" },
  });

  let halted = false;
  let haltedReason: string | null = null;

  if (existing && existing.weekKey === weekKey && existing.halted) {
    halted = true;
    haltedReason = existing.haltedReason;
  } else if (lossPct >= maxLossPct) {
    halted = true;
    haltedReason = `Weekly copy loss ${(lossPct * 100).toFixed(1)}% ≥ ${(maxLossPct * 100).toFixed(0)}% cap — no new mirrors until next week`;
  }

  await prisma.copyWeeklyRiskState.upsert({
    where: { id: "current" },
    create: {
      id: "current",
      weekKey,
      bankrollUsd,
      realizedPnlUsd: realized,
      unrealizedPnlUsd: unrealized,
      halted,
      haltedReason,
    },
    update: {
      weekKey,
      bankrollUsd,
      realizedPnlUsd: realized,
      unrealizedPnlUsd: unrealized,
      halted,
      haltedReason,
    },
  });

  return {
    weekKey,
    bankrollUsd,
    realizedPnlUsd: realized,
    unrealizedPnlUsd: unrealized,
    totalPnlUsd,
    lossPct,
    maxLossPct,
    halted,
    haltedReason,
    canOpenNewMirrors: !halted,
  };
}
