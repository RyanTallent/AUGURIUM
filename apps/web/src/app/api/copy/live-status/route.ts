import { NextResponse } from "next/server";
import { prisma } from "@augurium/database";

export const dynamic = "force-dynamic";

function aggregateTopFails(
  rows: Array<{ disabledReason: string | null }>,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.disabledReason) continue;
    const key = row.disabledReason.split(" < ")[0] ?? row.disabledReason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));
}

export async function GET() {
  try {
    const [byStatus, recentOpen, recentSubmitted, recentBlocked, latestPipeline, copyEnabled, disabledControls, enabledLeaderRows] =
      await Promise.all([
      prisma.copyLiveMirror.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.copyLiveMirror.findMany({
        where: { status: "OPEN" },
        orderBy: { openedAt: "desc" },
        take: 10,
        include: {
          trader: { select: { address: true } },
          market: { select: { title: true, slug: true } },
        },
      }),
      prisma.copyLiveMirror.findMany({
        where: { status: "SUBMITTED" },
        orderBy: { submittedAt: "desc" },
        take: 10,
        include: {
          trader: { select: { address: true } },
          market: { select: { title: true, slug: true } },
        },
      }),
      prisma.copyLiveMirror.findMany({
        where: { status: "BLOCKED" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          trader: { select: { address: true } },
          market: { select: { title: true } },
        },
      }),
      prisma.ingestionRun.findFirst({
        where: { source: "copy:auto-pipeline", status: "completed" },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.copyTraderControl.count({ where: { enabled: true } }),
      prisma.copyTraderControl.findMany({
        where: { enabled: false },
        select: { disabledReason: true },
        take: 200,
        orderBy: { evaluatedAt: "desc" },
      }),
      prisma.copyTraderControl.findMany({
        where: { enabled: true },
        select: {
          trader: { select: { bestCategory: true, address: true } },
          copyScore: true,
          strengths: true,
        },
        orderBy: { copyScore: "desc" },
        take: 30,
      }),
    ]);

    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    const pipelineMeta =
      latestPipeline?.metadata && typeof latestPipeline.metadata === "object"
        ? (latestPipeline.metadata as Record<string, unknown>)
        : null;
    const pipelineTopFails = Array.isArray(pipelineMeta?.topFails)
      ? (pipelineMeta.topFails as Array<{ reason: string; count: number }>)
      : null;
    const topFails = pipelineTopFails ?? aggregateTopFails(disabledControls);
    const leadersByCategory = enabledLeaderRows.reduce<Record<string, number>>((acc, row) => {
      const cat = row.trader.bestCategory ?? "Other";
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});

    const mapMirror = (m: {
      id: string;
      status: string;
      requestedSizeUsd: number;
      entryPrice: number;
      providerOrderId: string | null;
      submittedAt: Date | null;
      openedAt: Date;
      side: string;
      trader: { address: string };
      market: { title: string; slug: string | null };
    }) => ({
      id: m.id,
      status: m.status,
      marketTitle: m.market.title,
      marketSlug: m.market.slug,
      side: m.side,
      sizeUsd: m.requestedSizeUsd,
      entryPrice: m.entryPrice,
      traderAddress: m.trader.address,
      providerOrderId: m.providerOrderId,
      submittedAt: m.submittedAt,
      openedAt: m.openedAt,
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      statusCounts,
      copyEnabled,
      topFails,
      leadersByCategory,
      enabledLeaders: enabledLeaderRows.map((r) => ({
        address: r.trader.address,
        category: r.trader.bestCategory,
        copyScore: r.copyScore,
        strengths: r.strengths,
      })),
      sampledWallets: (pipelineMeta?.sampledWallets as number | undefined) ?? null,
      skippedZeroUsOverlap: (pipelineMeta?.skippedZeroUsOverlap as number | undefined) ?? null,
      usEvaluated: (pipelineMeta?.usEvaluated as number | undefined) ?? null,
      bestMatchedMarkets: Array.isArray(pipelineMeta?.bestMatchedMarkets)
        ? pipelineMeta.bestMatchedMarkets
        : [],
      sourcePositionCount: (pipelineMeta?.sourcePositionCount as number | undefined) ?? null,
      noTradeReason: (pipelineMeta?.noTradeReason as string | null | undefined) ?? null,
      hasLiveTrade: recentOpen.length > 0 || recentSubmitted.length > 0,
      openMirrors: recentOpen.map(mapMirror),
      submittedMirrors: recentSubmitted.map(mapMirror),
      activeMirrors: [...recentOpen, ...recentSubmitted].map(mapMirror),
      sizing: latestPipeline
        ? {
            bankrollUsd: pipelineMeta?.bankrollUsd ?? null,
            availableUsd: pipelineMeta?.availableUsd ?? null,
            deployedUsd: pipelineMeta?.deployedUsd ?? null,
            tradeSizeUsd: pipelineMeta?.tradeSizeUsd ?? null,
            bankrollSource: pipelineMeta?.bankrollSource ?? null,
          }
        : null,
      usOpenPositions: Array.isArray(pipelineMeta?.usOpenPositions)
        ? (pipelineMeta.usOpenPositions as Array<{
            id: string;
            marketId: string;
            side: string;
            sizeUsd: number;
          }>)
        : [],
      recentBlocked: recentBlocked.map((m) => ({
        marketTitle: m.market.title,
        side: m.side,
        sizeUsd: m.requestedSizeUsd,
        traderAddress: m.trader.address,
        blockReason: m.blockReason,
        updatedAt: m.updatedAt,
      })),
      latestPipeline: latestPipeline
        ? {
            finishedAt: latestPipeline.finishedAt,
            itemCount: latestPipeline.itemCount,
            mirrorsSubmitted: pipelineMeta?.mirrorsSubmitted ?? null,
            copyEnabled: pipelineMeta?.copyEnabled ?? copyEnabled,
            topFails: pipelineTopFails ?? topFails,
            leadersByCategory: (pipelineMeta?.leadersByCategory as Record<string, number> | undefined) ?? leadersByCategory,
            sampledWallets: pipelineMeta?.sampledWallets ?? null,
            skippedZeroUsOverlap: pipelineMeta?.skippedZeroUsOverlap ?? null,
            usEvaluated: pipelineMeta?.usEvaluated ?? null,
            bestMatchedMarkets: pipelineMeta?.bestMatchedMarkets ?? null,
            sourcePositionCount: pipelineMeta?.sourcePositionCount ?? null,
            noTradeReason: pipelineMeta?.noTradeReason ?? null,
            liveReady: pipelineMeta?.liveReady ?? null,
            liveMirrorsBlocked: pipelineMeta?.liveMirrorsBlocked ?? null,
            bankrollUsd: pipelineMeta?.bankrollUsd ?? null,
            availableUsd: pipelineMeta?.availableUsd ?? null,
            deployedUsd: pipelineMeta?.deployedUsd ?? null,
            tradeSizeUsd: pipelineMeta?.tradeSizeUsd ?? null,
            bankrollSource: pipelineMeta?.bankrollSource ?? null,
            usOpenPositions: pipelineMeta?.usOpenPositions ?? null,
            lite: pipelineMeta?.lite ?? null,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "live status failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
