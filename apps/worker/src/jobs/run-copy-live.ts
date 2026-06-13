import { prisma } from "@augurium/database";
import {
  applyRiskToDecision,
  buildTraderTruth,
  computeLiveCopyReadiness,
  copyEfficiencyScore,
  decideCopyTrader,
  evaluateCopyWeeklyStopLoss,
  isPolymarketClobReady,
  isSourcePositionTooStale,
  canAddMarketExposure,
  leaderPositionRoi,
  computeLiveTradeSizeUsd,
  getLiveCopySizingConfig,
  sumOpenExposureUsd,
  canAddDeployedExposure,
} from "@augurium/copy-trading";
import {
  createExecutionProvider,
  getExecutionConfig,
  getPolymarketUsClient,
  hasUsPositionOnMarket,
  isLivePolymarketEnabled,
  isPolymarketUsReady,
  resolveUsMarketSlug,
  verifyUsOrderFill,
} from "@augurium/execution";
import type { ExecutionProvider } from "@augurium/execution";
import { notifyLiveCopyTrade } from "../lib/enqueue-live-copy-discord.js";
import { resolveLiveCopyBankroll } from "../lib/resolve-live-copy-bankroll.js";

type LiveMirrorRow = {
  id: string;
  status: string;
  sourcePositionKey: string;
  side: string;
  requestedSizeUsd: number;
  entryPrice: number;
  trader: { address: string };
  market: { title: string; slug: string | null };
};

async function finalizeMirrorClose(
  mirror: LiveMirrorRow,
  notify: boolean,
): Promise<void> {
  await prisma.copyLiveMirror.update({
    where: { id: mirror.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  if (notify) {
    await notifyLiveCopyTrade({
      kind: "closed",
      mirrorId: mirror.id,
      marketTitle: mirror.market.title,
      side: mirror.side,
      sizeUsd: mirror.requestedSizeUsd,
      entryPrice: mirror.entryPrice,
      traderAddress: mirror.trader.address,
    });
  }
}

/** Close OPEN mirror on Polymarket US; returns whether mirror row was closed. */
async function closeMirrorOnUs(params: {
  provider: ExecutionProvider;
  client: ReturnType<typeof getPolymarketUsClient>;
  mirror: LiveMirrorRow;
  logReason: string;
}): Promise<"closed" | "failed" | "skipped"> {
  const { provider, client, mirror, logReason } = params;

  if (mirror.status !== "OPEN") {
    await finalizeMirrorClose(mirror, mirror.status === "SUBMITTED");
    return "closed";
  }

  const slug = await resolveUsMarketSlug({
    slug: mirror.market.slug,
    title: mirror.market.title,
  });
  if (!slug) return "skipped";

  const before = await hasUsPositionOnMarket(client, slug);
  if (!before.ok) {
    await finalizeMirrorClose(mirror, true);
    return "closed";
  }

  console.log(`[worker] live copy close (${logReason}) slug=${slug}`);
  const closeResult = await provider.closePosition(slug);
  if (!closeResult.success) {
    await notifyLiveCopyTrade({
      kind: "blocked",
      mirrorId: mirror.id,
      marketTitle: mirror.market.title,
      side: mirror.side,
      sizeUsd: mirror.requestedSizeUsd,
      entryPrice: mirror.entryPrice,
      traderAddress: mirror.trader.address,
      blockReason: `close failed: ${closeResult.errorMessage ?? "closePosition failed"}`,
    });
    return "failed";
  }

  const after = await hasUsPositionOnMarket(client, slug);
  if (after.ok) {
    await notifyLiveCopyTrade({
      kind: "blocked",
      mirrorId: mirror.id,
      marketTitle: mirror.market.title,
      side: mirror.side,
      sizeUsd: mirror.requestedSizeUsd,
      entryPrice: mirror.entryPrice,
      traderAddress: mirror.trader.address,
      blockReason: "close submitted but Polymarket US position still open",
    });
    return "failed";
  }

  await finalizeMirrorClose(mirror, true);
  return "closed";
}

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
    let confirmed = pos.ok;
    if (!confirmed && m.providerOrderId) {
      const verified = await verifyUsOrderFill(
        client,
        m.providerOrderId,
        slug,
        undefined,
        true,
      );
      confirmed = verified.success;
    }
    if (confirmed) {
      await prisma.copyLiveMirror.update({
        where: { id: m.id },
        data: { status: "OPEN", openedAt: new Date() },
      });
      promoted++;
    } else {
      await prisma.copyLiveMirror.update({
        where: { id: m.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          blockReason: "reconciled: no US position after submit",
        },
      });
    }
  }
  if (promoted > 0) {
    console.log(
      `[worker] live copy reconciled ${promoted} SUBMITTED mirror(s) → OPEN (Polymarket US position confirmed)`,
    );
  }
  return promoted;
}

/** Close OPEN mirrors that no longer exist on Polymarket US (manual close, expiry, etc.). */
async function reconcileStaleOpenMirrors(): Promise<number> {
  const cfg = getExecutionConfig();
  if (cfg.provider !== "polymarket-us" || !isPolymarketUsReady()) return 0;

  const rows = await prisma.copyLiveMirror.findMany({
    where: { status: "OPEN" },
    include: { market: { select: { slug: true, title: true } } },
  });
  if (rows.length === 0) return 0;

  const client = getPolymarketUsClient();
  let closed = 0;
  for (const m of rows) {
    const slug = await resolveUsMarketSlug({
      slug: m.market.slug,
      title: m.market.title,
    });
    if (!slug) continue;
    const pos = await hasUsPositionOnMarket(client, slug);
    if (pos.ok) continue;

    await prisma.copyLiveMirror.update({
      where: { id: m.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        blockReason: "reconciled: no US position",
      },
    });
    closed++;
    console.log(
      `[worker] live copy reconciled OPEN → CLOSED (flat on US) mirror=${m.id} slug=${slug}`,
    );
  }
  if (closed > 0) {
    console.log(`[worker] live copy reconciled ${closed} stale OPEN mirror(s) against US portfolio`);
  }
  return closed;
}

const ENABLED = process.env.LIVE_COPY_ENABLED === "true";
const USE_PAPER_SOURCE = process.env.LIVE_COPY_USE_PAPER_SOURCE === "true";
const CLOSE_ON_LEADER_EXIT = process.env.LIVE_COPY_CLOSE_ON_EXIT !== "false";
const TAKE_PROFIT_PCT = Number(process.env.COPY_LIVE_TAKE_PROFIT_PCT ?? "0.2");
const TAKE_PROFIT_ENABLED = process.env.COPY_LIVE_TAKE_PROFIT_ENABLED !== "false";

export interface CopyLiveJobSummary {
  enabled: boolean;
  ready: boolean;
  mirrorsPending: number;
  mirrorsBlocked: number;
  mirrorsSubmitted: number;
  mirrorsClosed: number;
  bankrollUsd: number | null;
  availableUsd: number | null;
  deployedUsd: number | null;
  tradeSizeUsd: number | null;
  bankrollSource: string | null;
  usOpenPositions: Array<{ id: string; marketId: string; side: string; sizeUsd: number }>;
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
  const sizing = getLiveCopySizingConfig();
  const emptySizing = {
    bankrollUsd: null,
    availableUsd: null,
    deployedUsd: null,
    tradeSizeUsd: null,
    bankrollSource: null,
  };

  if (!ENABLED) {
    return {
      enabled: false,
      ready: readiness.ready,
      mirrorsPending: 0,
      mirrorsBlocked: 0,
      mirrorsSubmitted: 0,
      mirrorsClosed: 0,
      ...emptySizing,
      usOpenPositions: [],
      blockers: readiness.blockers,
      message: "LIVE_COPY_ENABLED is false",
    };
  }

  let mirrorsBlocked = 0;
  let mirrorsPending = 0;
  let mirrorsSubmitted = 0;
  let mirrorsClosed = 0;

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

  const sourceKeys = new Set(sources.map((s) => s.sourcePositionKey));
  const cfg = getExecutionConfig();
  let provider: ExecutionProvider | null = null;
  let client: ReturnType<typeof getPolymarketUsClient> | null = null;

  if (readiness.ready && isLivePolymarketEnabled(cfg)) {
    const executionReady =
      cfg.provider === "polymarket-us" ? isPolymarketUsReady() : isPolymarketClobReady();
    if (executionReady) {
      provider = createExecutionProvider();
      await reconcileSubmittedMirrors();
      mirrorsClosed += await reconcileStaleOpenMirrors();
      client = cfg.provider === "polymarket-us" ? getPolymarketUsClient() : null;

      const activeMirrors = await prisma.copyLiveMirror.findMany({
        where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
        include: {
          trader: { select: { address: true } },
          market: { select: { title: true, slug: true } },
        },
      });
      const mirrorsToExit = activeMirrors.filter((m) => !sourceKeys.has(m.sourcePositionKey));

      if (CLOSE_ON_LEADER_EXIT && client) {
        for (const m of mirrorsToExit) {
          const result = await closeMirrorOnUs({
            provider,
            client,
            mirror: m,
            logReason: "leader exited",
          });
          if (result === "closed") mirrorsClosed++;
        }
      } else {
        for (const m of mirrorsToExit) {
          if (m.status === "OPEN") continue;
          await finalizeMirrorClose(m, m.status === "SUBMITTED");
          mirrorsClosed++;
        }
      }

      if (TAKE_PROFIT_ENABLED && client && TAKE_PROFIT_PCT > 0) {
        const openForProfit = await prisma.copyLiveMirror.findMany({
          where: { status: "OPEN" },
          include: {
            trader: { select: { address: true } },
            market: { select: { title: true, slug: true } },
          },
        });

        for (const m of openForProfit) {
          const source = await prisma.position.findUnique({
            where: { externalKey: m.sourcePositionKey },
            select: { pnl: true, size: true, avgPrice: true, status: true },
          });
          if (!source || source.status !== "open") continue;

          const roi = leaderPositionRoi(source.pnl, source.size, source.avgPrice);
          if (roi < TAKE_PROFIT_PCT) continue;

          const result = await closeMirrorOnUs({
            provider,
            client,
            mirror: m,
            logReason: `take profit ${(roi * 100).toFixed(1)}% (target ${(TAKE_PROFIT_PCT * 100).toFixed(0)}%)`,
          });
          if (result === "closed") mirrorsClosed++;
        }
      }
    }
  }

  const bankroll = await resolveLiveCopyBankroll(provider ?? undefined);
  const weekly = await evaluateCopyWeeklyStopLoss(bankroll.bankrollUsd);
  const blockReason = weekly.halted
    ? weekly.haltedReason
    : readiness.blockers.length > 0
      ? readiness.blockers.join("; ")
      : null;

  console.log(
    `[worker] live copy sizing bankroll=$${bankroll.bankrollUsd.toFixed(2)} available=$${bankroll.availableUsd.toFixed(2)} source=${bankroll.source} maxDeploy=${(sizing.maxDeployedPct * 100).toFixed(0)}% tradePct=${(sizing.positionPct * 100).toFixed(0)}%`,
  );

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

  const tradeSizeUsd = computeLiveTradeSizeUsd(
    bankroll.bankrollUsd,
    sumOpenExposureUsd(exposureBase),
    sizing,
    bankroll.availableUsd,
  );

  for (const src of sources) {
    const deployedNow = sumOpenExposureUsd(exposureBase);
    const sizeUsd = computeLiveTradeSizeUsd(
      bankroll.bankrollUsd,
      deployedNow,
      sizing,
      bankroll.availableUsd,
    );

    const existing = await prisma.copyLiveMirror.findUnique({
      where: { sourcePositionKey: src.sourcePositionKey },
    });

    let localBlock = blockReason;
    if (!localBlock && sizeUsd <= 0) {
      localBlock = "no deploy room or insufficient buying power";
    }
    if (!localBlock && isSourcePositionTooStale(src.pnl, src.size, src.avgPrice)) {
      localBlock = "source position too far in profit (late copy)";
    }
    if (!localBlock && !blockReason) {
      const deployCap = canAddDeployedExposure(
        bankroll.bankrollUsd,
        deployedNow,
        sizeUsd,
        sizing.maxDeployedPct,
      );
      if (!deployCap.allowed) localBlock = deployCap.reason;
    }
    if (!localBlock && !blockReason) {
      const cap = canAddMarketExposure(bankroll.bankrollUsd, exposureBase, {
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

    if (!localBlock && existing.status === "BLOCKED") {
      await prisma.copyLiveMirror.update({
        where: { id: existing.id },
        data: { status: "PENDING", blockReason: null, requestedSizeUsd: sizeUsd },
      });
      mirrorsPending++;
      exposureBase.push({
        traderId: src.traderId,
        address: src.traderId,
        marketId: src.marketId,
        category: null,
        usd: sizeUsd,
      });
      continue;
    }

    if (
      !localBlock &&
      existing.status === "PENDING" &&
      Math.abs(existing.requestedSizeUsd - sizeUsd) >= 0.01
    ) {
      await prisma.copyLiveMirror.update({
        where: { id: existing.id },
        data: { requestedSizeUsd: sizeUsd },
      });
      const row = exposureBase.find(
        (r) => r.traderId === src.traderId && r.marketId === src.marketId,
      );
      if (row) row.usd = sizeUsd;
    }

    if (localBlock && existing.status !== "OPEN" && existing.status !== "SUBMITTED") {
      await prisma.copyLiveMirror.update({
        where: { id: existing.id },
        data: { status: "BLOCKED", blockReason: localBlock },
      });
      mirrorsBlocked++;
    }
  }

  if (provider && readiness.ready && isLivePolymarketEnabled(cfg)) {
    const pending = await prisma.copyLiveMirror.findMany({
      where: { status: "PENDING" },
      take: 10,
      include: {
        trader: { select: { address: true } },
        market: { select: { clobTokenIds: true, conditionId: true, slug: true, title: true } },
      },
    });

    for (const mirror of pending) {
      const freshBankroll = await resolveLiveCopyBankroll(provider);
      const activeExposure = await prisma.copyLiveMirror.findMany({
        where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
        select: { requestedSizeUsd: true },
      });
      const deployedNow = sumOpenExposureUsd(
        activeExposure.map((r) => ({ usd: r.requestedSizeUsd })),
      );
      const orderSizeUsd = computeLiveTradeSizeUsd(
        freshBankroll.bankrollUsd,
        deployedNow - mirror.requestedSizeUsd,
        sizing,
        freshBankroll.availableUsd,
      );

      if (orderSizeUsd <= 0) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "BLOCKED",
            blockReason: "no deploy room or insufficient buying power",
          },
        });
        mirrorsBlocked++;
        continue;
      }

      if (Math.abs(mirror.requestedSizeUsd - orderSizeUsd) >= 0.01) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: { requestedSizeUsd: orderSizeUsd },
        });
      }

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
            sizeUsd: orderSizeUsd,
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
            sizeUsd: orderSizeUsd,
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
        requestedSizeUsd: orderSizeUsd,
        requestedPrice: mirror.entryPrice,
        asset: tokenId,
      });

      console.log(
        `[worker] live copy order mirror=${mirror.id} slug=${tokenId} title="${mirror.market.title}" success=${result.success} orderId=${result.providerOrderId ?? "none"}`,
      );

      if (result.success) {
        const filledUsd = result.filledSizeUsd ?? orderSizeUsd;
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
          sizeUsd: orderSizeUsd,
          entryPrice: mirror.entryPrice,
          traderAddress: mirror.trader.address,
          blockReason: result.errorMessage ?? "placeOrder failed",
        });
      }
    }
  }

  const finalDeployed = sumOpenExposureUsd(
    (
      await prisma.copyLiveMirror.findMany({
        where: { status: { in: ["PENDING", "SUBMITTED", "OPEN"] } },
        select: { requestedSizeUsd: true },
      })
    ).map((r) => ({ usd: r.requestedSizeUsd })),
  );

  let usOpenPositions: CopyLiveJobSummary["usOpenPositions"] = [];
  if (provider && cfg.provider === "polymarket-us") {
    try {
      const rows = await provider.getOpenPositions();
      usOpenPositions = rows.map((r) => ({
        id: r.id,
        marketId: r.marketId,
        side: r.side,
        sizeUsd: r.sizeUsd,
      }));
      if (usOpenPositions.length > 0) {
        console.log(
          `[worker] live copy US open positions (${usOpenPositions.length}): ${usOpenPositions.map((p) => `${p.id} $${p.sizeUsd.toFixed(2)}`).join("; ")}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[worker] live copy US position sync failed: ${message}`);
    }
  }

  return {
    enabled: true,
    ready: readiness.ready,
    mirrorsPending,
    mirrorsBlocked,
    mirrorsSubmitted,
    mirrorsClosed,
    bankrollUsd: bankroll.bankrollUsd,
    availableUsd: bankroll.availableUsd,
    deployedUsd: finalDeployed,
    tradeSizeUsd,
    bankrollSource: bankroll.source,
    usOpenPositions,
    blockers: readiness.blockers,
    message: blockReason
      ? `live copy blocked: ${blockReason}`
      : `live copy: bankroll=$${bankroll.bankrollUsd.toFixed(0)} deployed=$${finalDeployed.toFixed(0)} nextTrade=$${tradeSizeUsd.toFixed(0)} pending=${mirrorsPending} opened=${mirrorsSubmitted} closed=${mirrorsClosed}`,
  };
}
