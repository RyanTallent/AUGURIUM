import { prisma } from "@augurium/database";

export interface CopyMirrorAnalytics {
  openMirrors: number;
  closedMirrors: number;
  paperPnlUsd: number;
  sourcePnlUsd: number;
  paperVsSourceRatio: number | null;
  avgMirrorRoi: number;
  generatedAt: string;
}

export async function computeCopyMirrorAnalytics(): Promise<CopyMirrorAnalytics> {
  const open = await prisma.copyPaperPosition.findMany({
    where: { status: "OPEN" },
    select: {
      sourcePositionKey: true,
      unrealizedPnl: true,
      mirroredSizeUsd: true,
      traderId: true,
    },
  });

  const closed = await prisma.copyPaperPosition.aggregate({
    where: { status: "CLOSED" },
    _sum: { realizedPnl: true },
    _count: true,
  });

  const keys = open.map((o) => o.sourcePositionKey);
  const sources =
    keys.length > 0
      ? await prisma.position.findMany({
          where: { externalKey: { in: keys } },
          select: { externalKey: true, pnl: true },
        })
      : [];

  const sourceByKey = new Map(sources.map((s) => [s.externalKey, s.pnl]));
  let paperOpenPnl = 0;
  let sourceOpenPnl = 0;
  for (const m of open) {
    paperOpenPnl += m.unrealizedPnl;
    sourceOpenPnl += sourceByKey.get(m.sourcePositionKey) ?? 0;
  }

  const paperPnlUsd = paperOpenPnl + (closed._sum.realizedPnl ?? 0);
  const sourcePnlUsd = sourceOpenPnl;
  const paperVsSourceRatio =
    Math.abs(sourcePnlUsd) > 1 ? paperPnlUsd / sourcePnlUsd : null;

  const openNotional = open.reduce((s, o) => s + o.mirroredSizeUsd, 0);
  const avgMirrorRoi = openNotional > 0 ? paperOpenPnl / openNotional : 0;

  return {
    openMirrors: open.length,
    closedMirrors: closed._count,
    paperPnlUsd,
    sourcePnlUsd,
    paperVsSourceRatio,
    avgMirrorRoi,
    generatedAt: new Date().toISOString(),
  };
}
