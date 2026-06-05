import { prisma } from "@augurium/database";
import {
  capAllocationPct,
  computeLiveCopyReadiness,
  evaluateCopyWeeklyStopLoss,
  isPolymarketClobReady,
} from "@augurium/copy-trading";
import {
  createExecutionProvider,
  getExecutionConfig,
  isLivePolymarketEnabled,
} from "@augurium/execution";

const LIVE_BANKROLL = Number(process.env.COPY_LIVE_BANKROLL_USD ?? process.env.COPY_PAPER_BANKROLL_USD ?? "10000");
const ENABLED = process.env.LIVE_COPY_ENABLED === "true";

export interface CopyLiveJobSummary {
  enabled: boolean;
  ready: boolean;
  mirrorsPending: number;
  mirrorsBlocked: number;
  mirrorsSubmitted: number;
  mirrorsClosed: number;
  blockers: string[];
  message: string;
}

export async function runCopyLiveJob(): Promise<CopyLiveJobSummary> {
  const readiness = await computeLiveCopyReadiness();
  const weekly = await evaluateCopyWeeklyStopLoss(LIVE_BANKROLL);

  if (!ENABLED) {
    return {
      enabled: false,
      ready: readiness.ready,
      mirrorsPending: 0,
      mirrorsBlocked: 0,
      mirrorsSubmitted: 0,
      mirrorsClosed: 0,
      blockers: readiness.blockers,
      message: "LIVE_COPY_ENABLED is false — live mirror intents only when enabled",
    };
  }

  const paperOpen = await prisma.copyPaperPosition.findMany({
    where: { status: "OPEN" },
    include: {
      trader: { select: { id: true } },
    },
  });

  let mirrorsBlocked = 0;
  let mirrorsPending = 0;
  let mirrorsSubmitted = 0;
  let mirrorsClosed = 0;

  const blockReason = weekly.halted
    ? weekly.haltedReason
    : readiness.blockers.length > 0
      ? readiness.blockers.join("; ")
      : null;

  for (const paper of paperOpen) {
    const pct = capAllocationPct(0.05);
    const sizeUsd = Math.round(LIVE_BANKROLL * pct * 100) / 100;

    const existing = await prisma.copyLiveMirror.findUnique({
      where: { sourcePositionKey: paper.sourcePositionKey },
    });

    if (!existing) {
      await prisma.copyLiveMirror.create({
        data: {
          traderId: paper.traderId,
          sourcePositionKey: paper.sourcePositionKey,
          marketId: paper.marketId,
          side: paper.side,
          requestedSizeUsd: sizeUsd,
          entryPrice: paper.entryPrice,
          status: blockReason ? "BLOCKED" : "PENDING",
          blockReason,
        },
      });
      if (blockReason) mirrorsBlocked++;
      else mirrorsPending++;
      continue;
    }

    if (blockReason && existing.status !== "OPEN" && existing.status !== "SUBMITTED") {
      await prisma.copyLiveMirror.update({
        where: { id: existing.id },
        data: { status: "BLOCKED", blockReason },
      });
      mirrorsBlocked++;
    }
  }

  const paperKeys = new Set(paperOpen.map((p) => p.sourcePositionKey));
  const openMirrors = await prisma.copyLiveMirror.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
  });

  for (const m of openMirrors) {
    if (paperKeys.has(m.sourcePositionKey)) continue;
    await prisma.copyLiveMirror.update({
      where: { id: m.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    mirrorsClosed++;
  }

  if (readiness.ready && isPolymarketClobReady() && isLivePolymarketEnabled(getExecutionConfig())) {
    const provider = createExecutionProvider();
    const pending = await prisma.copyLiveMirror.findMany({
      where: { status: "PENDING" },
      take: 10,
    });

    for (const mirror of pending) {
      const result = await provider.placeOrder({
        idempotencyKey: `copy-live:${mirror.sourcePositionKey}`,
        signalId: mirror.sourcePositionKey,
        marketId: mirror.marketId,
        side: mirror.side,
        orderType: "LIMIT",
        requestedSizeUsd: mirror.requestedSizeUsd,
        requestedPrice: mirror.entryPrice,
      });

      if (result.success) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "SUBMITTED",
            providerOrderId: result.providerOrderId ?? null,
            submittedAt: new Date(),
            blockReason: null,
          },
        });
        mirrorsSubmitted++;
      } else {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "BLOCKED",
            blockReason: result.errorMessage ?? "placeOrder failed",
          },
        });
        mirrorsBlocked++;
      }
    }
  }

  return {
    enabled: true,
    ready: readiness.ready,
    mirrorsPending,
    mirrorsBlocked,
    mirrorsSubmitted,
    mirrorsClosed,
    blockers: readiness.blockers,
    message: blockReason
      ? `live copy blocked: ${blockReason}`
      : `live copy: pending=${mirrorsPending} submitted=${mirrorsSubmitted}`,
  };
}
