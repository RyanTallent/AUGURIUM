import { NextResponse } from "next/server";
import { prisma } from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [byStatus, recentOpen, recentSubmitted, recentBlocked, latestPipeline] = await Promise.all([
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
    ]);

    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    const pipelineMeta =
      latestPipeline?.metadata && typeof latestPipeline.metadata === "object"
        ? (latestPipeline.metadata as Record<string, unknown>)
        : null;

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
