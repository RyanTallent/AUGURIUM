import { prisma } from "./client.js";

import type { ReadinessGrade } from "./portfolio-validation.js";

export interface PaperValidationReport {
  completedTrades: number;
  winRate: number;
  averageRoi: number;
  maxDrawdown: number;
  profitFactor: number;
  expectedValue: number;
  grade: ReadinessGrade;
  meetsMinimumSample: boolean;
  generatedAt: string;
}

export async function computePaperValidation(): Promise<PaperValidationReport> {
  const positions = await prisma.executionPosition.findMany({
    where: { status: "CLOSED" },
    select: {
      status: true,
      realizedPnl: true,
      sizeUsd: true,
      unrealizedPnl: true,
    },
  });

  const completed = positions.filter((p) => p.status === "CLOSED");
  const pnls = completed.map((o) => o.realizedPnl);
  const notionals = completed.map((o) => Math.max(1, o.sizeUsd));
  const rois = completed.map((o, i) => o.realizedPnl / notionals[i]!);

  const wins = pnls.filter((p) => p > 0).length;
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
  const meetsMinimumSample = completed.length >= 100;

  let grade: ReadinessGrade = "WARNING";
  if (meetsMinimumSample && expectedValue > 0) grade = "PASS";
  if (completed.length === 0) grade = "FAIL";

  return {
    completedTrades: completed.length,
    winRate: completed.length ? wins / completed.length : 0,
    averageRoi: expectedValue,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
    expectedValue,
    grade,
    meetsMinimumSample,
    generatedAt: new Date().toISOString(),
  };
}
