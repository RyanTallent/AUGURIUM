import { prisma } from "./client.js";

export type ReadinessGrade = "PASS" | "WARNING" | "FAIL";

export interface PortfolioValidationReport {
  openPositions: number;
  closedPositions: number;
  allocationAcceptRate: number;
  averagePositionRoi: number;
  realizedRoi: number;
  unrealizedRoi: number;
  maxDrawdown: number;
  categoryExposure: Record<string, number>;
  grade: ReadinessGrade;
  generatedAt: string;
}

export async function computePortfolioValidation(): Promise<PortfolioValidationReport> {
  const [decisions, positions, state] = await Promise.all([
    prisma.portfolioDecision.findMany({
      select: { decision: true, reasons: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.portfolioPosition.findMany({
      select: {
        status: true,
        realizedPnl: true,
        unrealizedPnl: true,
        allocatedUsd: true,
        category: true,
      },
    }),
    prisma.portfolioState.findUnique({ where: { id: "current" } }),
  ]);

  const accepts = decisions.filter((d) => d.decision === "ACCEPT").length;
  const allocationAcceptRate = decisions.length ? accepts / decisions.length : 0;

  const open = positions.filter((p) => p.status === "OPEN");
  const closed = positions.filter((p) => p.status !== "OPEN");

  const realizedRoi =
    closed.reduce((s, p) => s + p.realizedPnl, 0) /
    Math.max(1, closed.reduce((s, p) => s + p.allocatedUsd, 0));
  const unrealizedRoi =
    open.reduce((s, p) => s + p.unrealizedPnl, 0) /
    Math.max(1, open.reduce((s, p) => s + p.allocatedUsd, 0));

  const categoryExposure: Record<string, number> = {};
  const totalAlloc = positions.reduce((s, p) => s + p.allocatedUsd, 0) || 1;
  for (const p of positions) {
    const cat = p.category ?? "Unknown";
    categoryExposure[cat] = (categoryExposure[cat] ?? 0) + p.allocatedUsd / totalAlloc;
  }

  let grade: ReadinessGrade = "PASS";
  if (positions.length < 5) grade = "WARNING";
  if (allocationAcceptRate < 0.05 && decisions.length > 20) grade = "WARNING";

  return {
    openPositions: open.length,
    closedPositions: closed.length,
    allocationAcceptRate,
    averagePositionRoi:
      positions.length > 0
        ? positions.reduce((s, p) => s + (p.realizedPnl + p.unrealizedPnl) / Math.max(1, p.allocatedUsd), 0) /
          positions.length
        : 0,
    realizedRoi,
    unrealizedRoi,
    maxDrawdown: state?.currentDrawdown ?? 0,
    categoryExposure,
    grade,
    generatedAt: new Date().toISOString(),
  };
}
