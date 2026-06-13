import { prisma } from "@augurium/database";
import {
  applyRiskToDecision,
  buildTraderTruth,
  capAllocationPct,
  computeLiveCopyReadiness,
  copyEfficiencyScore,
  decideCopyTrader,
  evaluateCopyWeeklyStopLoss,
  isPolymarketClobReady,
  isSourcePositionTooStale,
  canAddMarketExposure,
} from "@augurium/copy-trading";
import {
  createExecutionProvider,
  getExecutionConfig,
  getPolymarketUsClient,
  hasUsPositionOnMarket,
  isLivePolymarketEnabled,
  isPolymarketUsReady,
  resolveUsMarketSlug,
} from "@augurium/execution";
import { notifyLiveCopyTrade } from "../lib/enqueue-live-copy-discord.js";

async function reconcileSubmittedMirrors(): Promise<number> {
  const cfg = getExecutionConfig();
  if (cfg.provider !== "polymarket-us" || !isPolymarketUsReady()) return 0;

  const rows = await prisma.copyLiveMirror.findMany({
    where: { status: "SUBMITTED" },
    include: { market: { select: { slug: true, title: true } } },
  });
  if (rows.length === 0) return 0;

  const client = getPolymarketUsClient();
  let promoted = 0;
  for (const m of rows) {
    const slug = await resolveUsMarketSlug({
      slug: m.market.slug,
      title: m.market.title,
    });
    if (!slug) continue;
    const pos = await hasUsPositionOnMarket(client, slug);
    if (pos.ok) {
      await prisma.copyLiveMirror.update({
        where: { id: m.id },
        data: { status: "OPEN", openedAt: new Date() },
      });
      promoted++;
    }
  }
  if (promoted > 0) {
    console.log(
      `[worker] live copy reconciled ${promoted} SUBMITTED mirror(s) → OPEN (Polymarket US position confirmed)`,
    );
  }
  return promoted;
}

const LIVE_BANKROLL = Number(
  process.env.COPY_LIVE_BANKROLL_USD ?? process.env.COPY_PAPER_BANKROLL_USD ?? "500",
);
const ENABLED = process.env.LIVE_COPY_ENABLED === "true";
const USE_PAPER_SOURCE = process.env.LIVE_COPY_USE_PAPER_SOURCE === "true";

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

async function loadCopyTargetPositions(): Promise<
  Array<{
    traderId: string;
    sourcePositionKey: string;
    marketId: string;
    side: string;
    entryPrice: number;
    asset: string | null;
    pnl: number;
    size: number;
    avgPrice: number;
  }>
> {
  const traders = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: 120,
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });

  const ranked = traders.map((t) => {
    const truth = buildTraderTruth(t, t.metricsSnapshots[0] ?? null);
    const decision = applyRiskToDecision(decideCopyTrader(truth), truth);
    return { traderId: t.id, decision, efficiency: copyEfficiencyScore(truth, decision) };
  });

  const topIds = ranked
    .filter((r) => r.decision.recommendation === "COPY")
    .sort((a, b) => b.efficiency - a.efficiency)
    .slice(0, 40)
    .map((r) => r.traderId);

  const rows = await prisma.position.findMany({
    where: { status: "open", traderId: { in: topIds } },
    select: {
      traderId: true,
      externalKey: true,
      marketId: true,
      side: true,
      avgPrice: true,
      asset: true,
      pnl: true,
      size: true,
    },
  });

  return rows.map((r) => ({
    traderId: r.traderId,
    sourcePositionKey: r.externalKey,
    marketId: r.marketId,
    side: r.side,
    entryPrice: r.avgPrice,
    asset: r.asset,
    pnl: r.pnl,
    size: r.size,
    avgPrice: r.avgPrice,
  }));
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
      message: "LIVE_COPY_ENABLED is false",
    };
  }

  let mirrorsBlocked = 0;
  let mirrorsPending = 0;
  let mirrorsSubmitted = 0;
  let mirrorsClosed = 0;

  const blockReason = weekly.halted
    ? weekly.haltedReason
    : readiness.blockers.length > 0
      ? readiness.blockers.join("; ")
      : null;

  const sources = USE_PAPER_SOURCE
    ? (
        await prisma.copyPaperPosition.findMany({
          where: { status: "OPEN" },
          include: { trader: true },
        })
      ).map((p) => ({
        traderId: p.traderId,
        sourcePositionKey: p.sourcePositionKey,
        marketId: p.marketId,
        side: p.side,
        entryPrice: p.entryPrice,
        asset: null as string | null,
        pnl: 0,
        size: 0,
        avgPrice: p.entryPrice,
      }))
    : await loadCopyTargetPositions();

  const openExposure = await prisma.copyLiveMirror.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
    select: { traderId: true, marketId: true, requestedSizeUsd: true },
  });
  const exposureBase = openExposure.map((r) => ({
    traderId: r.traderId,
    address: r.traderId,
    marketId: r.marketId,
    category: null,
    usd: r.requestedSizeUsd,
  }));

  for (const src of sources) {
    const pct = capAllocationPct(0.05);
    const sizeUsd = Math.round(LIVE_BANKROLL * pct * 100) / 100;
    if (sizeUsd <= 0) continue;

    const existing = await prisma.copyLiveMirror.findUnique({
      where: { sourcePositionKey: src.sourcePositionKey },
    });

    let localBlock = blockReason;
    if (!localBlock && isSourcePositionTooStale(src.pnl, src.size, src.avgPrice)) {
      localBlock = "source position too far in profit (late copy)";
    }
    if (!localBlock && !blockReason) {
      const cap = canAddMarketExposure(LIVE_BANKROLL, exposureBase, {
        traderId: src.traderId,
        address: src.traderId,
        marketId: src.marketId,
        category: null,
        usd: sizeUsd,
      });
      if (!cap.allowed) localBlock = cap.reason;
    }

    if (!existing) {
      await prisma.copyLiveMirror.create({
        data: {
          traderId: src.traderId,
          sourcePositionKey: src.sourcePositionKey,
          marketId: src.marketId,
          side: src.side,
          requestedSizeUsd: sizeUsd,
          entryPrice: src.entryPrice,
          status: localBlock ? "BLOCKED" : "PENDING",
          blockReason: localBlock,
        },
      });
      if (localBlock) mirrorsBlocked++;
      else {
        mirrorsPending++;
        exposureBase.push({
          traderId: src.traderId,
          address: src.traderId,
          marketId: src.marketId,
          category: null,
          usd: sizeUsd,
        });
      }
      continue;
    }

    if (localBlock && existing.status !== "OPEN" && existing.status !== "SUBMITTED") {
      await prisma.copyLiveMirror.update({
        where: { id: existing.id },
        data: { status: "BLOCKED", blockReason: localBlock },
      });
      mirrorsBlocked++;
    }
  }

  const sourceKeys = new Set(sources.map((s) => s.sourcePositionKey));
  const openMirrors = await prisma.copyLiveMirror.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true } },
    },
  });

  for (const m of openMirrors) {
    if (sourceKeys.has(m.sourcePositionKey)) continue;
    await prisma.copyLiveMirror.update({
      where: { id: m.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    mirrorsClosed++;
    if (m.status === "SUBMITTED" || m.status === "OPEN") {
      await notifyLiveCopyTrade({
        kind: "closed",
        mirrorId: m.id,
        marketTitle: m.market.title,
        side: m.side,
        sizeUsd: m.requestedSizeUsd,
        entryPrice: m.entryPrice,
        traderAddress: m.trader.address,
      });
    }
  }

  if (readiness.ready && isLivePolymarketEnabled(getExecutionConfig())) {
    const cfg = getExecutionConfig();
    const executionReady =
      cfg.provider === "polymarket-us" ? isPolymarketUsReady() : isPolymarketClobReady();
    if (!executionReady) {
      return {
        enabled: true,
        ready: readiness.ready,
        mirrorsPending,
        mirrorsBlocked,
        mirrorsSubmitted,
        mirrorsClosed,
        blockers: readiness.blockers,
        message: "live copy: execution provider not ready",
      };
    }

    const provider = createExecutionProvider();
    await reconcileSubmittedMirrors();

    const pending = await prisma.copyLiveMirror.findMany({
      where: { status: "PENDING" },
      take: 5,
      include: {
        trader: { select: { address: true } },
        market: { select: { clobTokenIds: true, conditionId: true, slug: true, title: true } },
      },
    });

    for (const mirror of pending) {
      let tokenId: string | null = null;

      if (cfg.provider === "polymarket-us") {
        tokenId = await resolveUsMarketSlug({
          slug: mirror.market.slug,
          title: mirror.market.title,
        });
        if (!tokenId) {
          await prisma.copyLiveMirror.update({
            where: { id: mirror.id },
            data: {
              status: "BLOCKED",
              blockReason: "no matching Polymarket US market slug",
            },
          });
          mirrorsBlocked++;
          await notifyLiveCopyTrade({
            kind: "blocked",
            mirrorId: mirror.id,
            marketTitle: mirror.market.title,
            side: mirror.side,
            sizeUsd: mirror.requestedSizeUsd,
            entryPrice: mirror.entryPrice,
            traderAddress: mirror.trader.address,
            blockReason: "no matching Polymarket US market slug",
          });
          continue;
        }
      } else {
        const pos = await prisma.position.findUnique({
          where: { externalKey: mirror.sourcePositionKey },
          select: { asset: true },
        });
        tokenId = pos?.asset ?? mirror.market.clobTokenIds?.[0] ?? null;
        if (!tokenId) {
          await prisma.copyLiveMirror.update({
            where: { id: mirror.id },
            data: { status: "BLOCKED", blockReason: "no CLOB token id for market" },
          });
          mirrorsBlocked++;
          await notifyLiveCopyTrade({
            kind: "blocked",
            mirrorId: mirror.id,
            marketTitle: mirror.market.title,
            side: mirror.side,
            sizeUsd: mirror.requestedSizeUsd,
            entryPrice: mirror.entryPrice,
            traderAddress: mirror.trader.address,
            blockReason: "no CLOB token id for market",
          });
          continue;
        }
      }

      const result = await provider.placeOrder({
        idempotencyKey: `copy-live:${mirror.sourcePositionKey}`,
        signalId: mirror.sourcePositionKey,
        marketId: mirror.marketId,
        side: mirror.side,
        orderType: "MARKET",
        requestedSizeUsd: mirror.requestedSizeUsd,
        requestedPrice: mirror.entryPrice,
        asset: tokenId,
      });

      if (result.success) {
        const filledUsd = result.filledSizeUsd ?? mirror.requestedSizeUsd;
        const entryPrice = result.fillPrice ?? mirror.entryPrice;
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "OPEN",
            providerOrderId: result.providerOrderId ?? null,
            submittedAt: new Date(),
            openedAt: new Date(),
            entryPrice,
            requestedSizeUsd: filledUsd,
            blockReason: null,
          },
        });
        mirrorsSubmitted++;
        await notifyLiveCopyTrade({
          kind: "filled",
          mirrorId: mirror.id,
          marketTitle: mirror.market.title,
          side: mirror.side,
          sizeUsd: filledUsd,
          entryPrice,
          traderAddress: mirror.trader.address,
          providerOrderId: result.providerOrderId ?? null,
        });
      } else {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "BLOCKED",
            blockReason: result.errorMessage ?? "placeOrder failed",
          },
        });
        mirrorsBlocked++;
        await notifyLiveCopyTrade({
          kind: "blocked",
          mirrorId: mirror.id,
          marketTitle: mirror.market.title,
          side: mirror.side,
          sizeUsd: mirror.requestedSizeUsd,
          entryPrice: mirror.entryPrice,
          traderAddress: mirror.trader.address,
          blockReason: result.errorMessage ?? "placeOrder failed",
        });
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
