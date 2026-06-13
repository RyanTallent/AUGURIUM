import { NextResponse } from "next/server";
import { prisma } from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [byStatus, recentSubmitted, recentBlocked, latestPipeline] = await Promise.all([
      prisma.copyLiveMirror.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.copyLiveMirror.findMany({
        where: { status: { in: ["SUBMITTED", "OPEN"] } },
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

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      statusCounts,
      hasLiveTrade: recentSubmitted.length > 0,
      submittedMirrors: recentSubmitted.map((m) => ({
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
      })),
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
            lite: pipelineMeta?.lite ?? null,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "live status failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
