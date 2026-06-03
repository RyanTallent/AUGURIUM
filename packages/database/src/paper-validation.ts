import { prisma } from "./client.js";

import type { ReadinessGrade } from "./portfolio-validation.js";

export interface PaperValidationReport {
  paperOpens: number;
  completedTrades: number;
  progressTarget: number;
  progressPct: number;
  progressLabel: string;
  winRate: number;
  lossRate: number;
  averageRoi: number;
  maxDrawdown: number;
  profitFactor: number;
  expectedValue: number;
  grade: ReadinessGrade;
  meetsMinimumSample: boolean;
  generatedAt: string;
}

const PROGRESS_TARGET = 100;

function progressLabel(completed: number): string {
  if (completed >= 100) return "100 / 100";
  if (completed >= 50) return "50 / 100";
  if (completed >= 25) return "25 / 100";
  return `${completed} / 100`;
}

export async function computePaperValidation(): Promise<PaperValidationReport> {
  const [paperOpens, positions] = await Promise.all([
    prisma.executionPosition.count({
      where: { provider: "paper", status: "OPEN" },
    }),
    prisma.executionPosition.findMany({
      where: { provider: "paper", status: "CLOSED" },
      select: {
        realizedPnl: true,
        sizeUsd: true,
      },
    }),
  ]);

  const completed = positions;
  const pnls = completed.map((o) => o.realizedPnl);
  const rois = completed.map((o) => o.realizedPnl / Math.max(1, o.sizeUsd));

  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const grossWin = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const expectedValue = rois.length ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;
  const meetsMinimumSample = completed.length >= PROGRESS_TARGET;

  let grade: ReadinessGrade = "WARNING";
  if (completed.length === 0) grade = "FAIL";
  else if (meetsMinimumSample && expectedValue > 0) grade = "PASS";

  return {
    paperOpens,
    completedTrades: completed.length,
    progressTarget: PROGRESS_TARGET,
    progressPct: Math.min(100, (completed.length / PROGRESS_TARGET) * 100),
    progressLabel: progressLabel(completed.length),
    winRate: completed.length ? wins / completed.length : 0,
    lossRate: completed.length ? losses / completed.length : 0,
    averageRoi: expectedValue,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 10 : 0,
    expectedValue,
    grade,
    meetsMinimumSample,
    generatedAt: new Date().toISOString(),
  };
}
