import { prisma } from "@augurium/database";
import {
  computeLiveCopyReadiness,
  evaluateCopyWeeklyStopLoss,
  isPolymarketClobReady,
  isSourcePositionTooStale,
  canAddMarketExposure,
  leaderPositionRoi,
  computeConsensusTradeSizeUsd,
  getLiveCopySizingConfig,
  sumOpenExposureUsd,
  canAddDeployedExposure,
  evaluateCopyLiveLadder,
  getCopyLiveLadderConfig,
  ladderStateAfterRung,
  viewLadderState,
  buildTraderTruth,
  computeUsWalletScore,
  evaluateUsLeaderEntryGate,
  isRoutineUsTierSkipReason,
  type CopyLiveLadderAction,
} from "@augurium/copy-trading";
import {
  createExecutionProvider,
  getExecutionConfig,
  getPolymarketUsClient,
  hasUsPositionOnMarket,
  isLivePolymarketEnabled,
  isPolymarketUsReady,
  verifyUsOrderFill,
} from "@augurium/execution";
import type { ExecutionProvider } from "@augurium/execution";
import { notifyLiveCopyTrade, notifyWeeklyStopRisk, notifyJournalDecision } from "../lib/enqueue-live-copy-discord.js";
import { resolveLiveCopyBankroll } from "../lib/resolve-live-copy-bankroll.js";
import { loadTopCopyLeaderIds } from "../lib/refresh-copy-trader-controls.js";

type LiveMirrorRow = {
  id: string;
  status: string;
  sourcePositionKey: string;
  side: string;
  requestedSizeUsd: number;
  entryPrice: number;
  usMarketSlug?: string | null;
  trader: { address: string };
  market: { title: string; slug: string | null; category?: string | null };
};

async function resolveMirrorUsSlug(mirror: LiveMirrorRow): Promise<string | null> {
  if (mirror.usMarketSlug?.trim()) return mirror.usMarketSlug.trim();
  return mirror.market.slug?.trim() ?? null;
}

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

  const slug = await resolveMirrorUsSlug(mirror);
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

async function initMirrorLadderState(mirrorId: string, originalSizeUsd: number): Promise<void> {
  const config = getCopyLiveLadderConfig();
  await prisma.copyLiveLadderState.upsert({
    where: { mirrorId },
    create: {
      mirrorId,
      rungsCompleted: 0,
      remainingPct: 1,
      nextRungPct: config.rung1LeaderRoi,
      metadata: { originalSizeUsd },
    },
    update: {
      remainingPct: 1,
      nextRungPct: config.rung1LeaderRoi,
      metadata: { originalSizeUsd },
    },
  });
  await prisma.copyLiveMirror.update({
    where: { id: mirrorId },
    data: { ladderState: "active", ladderStep: 0 },
  });
}

/** Partial US sell at a ladder rung; mirror stays OPEN until leader exits. */
async function partialSellMirrorOnUs(params: {
  provider: ExecutionProvider;
  client: ReturnType<typeof getPolymarketUsClient>;
  mirror: LiveMirrorRow;
  action: CopyLiveLadderAction;
}): Promise<"sold" | "failed" | "skipped"> {
  const { provider, client, mirror, action } = params;
  if (mirror.status !== "OPEN") return "skipped";

  const slug = await resolveMirrorUsSlug(mirror);
  if (!slug) return "skipped";

  const before = await hasUsPositionOnMarket(client, slug);
  if (!before.ok || before.sizeUsd <= 0) return "skipped";

  const sellUsd = Math.min(action.sellUsd, before.sizeUsd * 0.98);
  if (sellUsd < 0.5) return "skipped";

  const fraction = Math.min(0.99, sellUsd / before.sizeUsd);
  console.log(
    `[worker] live copy partial sell rung=${action.rung} slug=${slug} sellUsd=${sellUsd.toFixed(2)} leaderRoi=${(action.leaderRoi * 100).toFixed(1)}%`,
  );

  const sellResult = await provider.closePosition(slug, fraction);
  if (!sellResult.success) {
    await notifyLiveCopyTrade({
      kind: "blocked",
      mirrorId: mirror.id,
      marketTitle: mirror.market.title,
      side: mirror.side,
      sizeUsd: sellUsd,
      entryPrice: mirror.entryPrice,
      traderAddress: mirror.trader.address,
      blockReason: `partial sell rung ${action.rung} failed: ${sellResult.errorMessage ?? "closePosition failed"}`,
    });
    return "failed";
  }

  const ladderRow = await prisma.copyLiveLadderState.findUnique({
    where: { mirrorId: mirror.id },
  });
  const view = viewLadderState({
    rungsCompleted: ladderRow?.rungsCompleted ?? 0,
    remainingPct: ladderRow?.remainingPct ?? 1,
    metadata: ladderRow?.metadata,
    requestedSizeUsd: mirror.requestedSizeUsd,
  });
  const next = ladderStateAfterRung(view, action);

  await prisma.copyLiveLadderState.upsert({
    where: { mirrorId: mirror.id },
    create: {
      mirrorId: mirror.id,
      rungsCompleted: next.rungsCompleted,
      remainingPct: next.remainingPct,
      nextRungPct: next.nextRungPct,
      metadata: { originalSizeUsd: view.originalSizeUsd },
    },
    update: {
      rungsCompleted: next.rungsCompleted,
      remainingPct: next.remainingPct,
      nextRungPct: next.nextRungPct,
    },
  });
  await prisma.copyLiveMirror.update({
    where: { id: mirror.id },
    data: {
      ladderStep: action.rung,
      ladderState: next.remainingPct <= 0.01 ? "complete" : "active",
    },
  });

  await notifyLiveCopyTrade({
    kind: "partial",
    mirrorId: mirror.id,
    marketTitle: mirror.market.title,
    side: mirror.side,
    sizeUsd: sellUsd,
    entryPrice: mirror.entryPrice,
    traderAddress: mirror.trader.address,
    ladderRung: action.rung,
    blockReason: `leader ROI ${(action.leaderRoi * 100).toFixed(1)}% — sold ${(action.sellPctOfOriginal * 100).toFixed(0)}% of original`,
  });

  return "sold";
}

async function processCopyLiveLadders(params: {
  provider: ExecutionProvider;
  client: ReturnType<typeof getPolymarketUsClient>;
}): Promise<number> {
  const { provider, client } = params;
  const config = getCopyLiveLadderConfig();
  if (!config.enabled) return 0;

  const openMirrors = await prisma.copyLiveMirror.findMany({
    where: { status: "OPEN" },
    include: {
      trader: { select: { address: true } },
      market: { select: { title: true, slug: true, category: true } },
    },
  });

  let partials = 0;
  for (const m of openMirrors) {
    const source = await prisma.position.findUnique({
      where: { externalKey: m.sourcePositionKey },
      select: { pnl: true, size: true, avgPrice: true, status: true },
    });
    if (!source || source.status !== "open") continue;

    const roi = leaderPositionRoi(source.pnl, source.size, source.avgPrice);
    const ladderRow = await prisma.copyLiveLadderState.findUnique({
      where: { mirrorId: m.id },
    });
    const view = viewLadderState({
      rungsCompleted: ladderRow?.rungsCompleted ?? m.ladderStep ?? 0,
      remainingPct: ladderRow?.remainingPct ?? 1,
      metadata: ladderRow?.metadata,
      requestedSizeUsd: m.requestedSizeUsd,
    });

    const action = evaluateCopyLiveLadder(roi, view, config);
    if (!action) continue;

    const result = await partialSellMirrorOnUs({
      provider,
      client,
      mirror: m,
      action,
    });
    if (result === "sold") partials++;
  }

  if (partials > 0) {
    console.log(`[worker] live copy ladder partial sells=${partials}`);
  }
  return partials;
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
    const slug = await resolveMirrorUsSlug({
      id: m.id,
      status: m.status,
      sourcePositionKey: m.sourcePositionKey,
      side: m.side,
      requestedSizeUsd: m.requestedSizeUsd,
      entryPrice: m.entryPrice,
      usMarketSlug: m.usMarketSlug,
      trader: { address: "" },
      market: m.market,
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
      await initMirrorLadderState(m.id, m.requestedSizeUsd);
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

function usPortfolioHasOpenPositions(
  positions: Record<string, { netPosition?: number | string | null }> | undefined,
): boolean {
  return Object.values(positions ?? {}).some(
    (pos) => Math.abs(Number(pos.netPosition ?? 0)) > 0,
  );
}

/** Close OPEN mirrors that no longer exist on Polymarket US (manual close, expiry, etc.). */
async function reconcileStaleOpenMirrors(): Promise<number> {
  const cfg = getExecutionConfig();
  if (cfg.provider !== "polymarket-us" || !isPolymarketUsReady()) return 0;

  const rows = await prisma.copyLiveMirror.findMany({
    where: { status: "OPEN" },
    include: { market: { select: { slug: true, title: true, category: true } } },
  });
  if (rows.length === 0) return 0;

  const client = getPolymarketUsClient();

  const portfolio = await client.portfolio.positions();
  if (!usPortfolioHasOpenPositions(portfolio.positions)) {
    const bulk = await prisma.copyLiveMirror.updateMany({
      where: { status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        blockReason: "reconciled: US portfolio flat",
      },
    });
    if (bulk.count > 0) {
      console.log(
        `[worker] live copy bulk-closed ${bulk.count} OPEN mirror(s) — US portfolio has no open positions`,
      );
    }
    return bulk.count;
  }

  let closed = 0;
  for (const m of rows) {
    let slug = m.usMarketSlug?.trim() || null;
    if (slug) {
      try {
        await client.markets.retrieveBySlug(slug);
      } catch {
        slug = null;
      }
    }
    if (!slug) {
      slug = await resolveMirrorUsSlug({
        id: m.id,
        status: m.status,
        sourcePositionKey: m.sourcePositionKey,
        side: m.side,
        requestedSizeUsd: m.requestedSizeUsd,
        entryPrice: m.entryPrice,
        usMarketSlug: m.usMarketSlug,
        trader: { address: "" },
        market: m.market,
      });
    }
    if (!slug) {
      await prisma.copyLiveMirror.update({
        where: { id: m.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          blockReason: "reconciled: no US market slug",
        },
      });
      closed++;
      continue;
    }
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
const LADDER_CONFIG = getCopyLiveLadderConfig();
const TAKE_PROFIT_PCT = Number(process.env.COPY_LIVE_TAKE_PROFIT_PCT ?? "0.2");
const TAKE_PROFIT_ENABLED =
  !LADDER_CONFIG.enabled && process.env.COPY_LIVE_TAKE_PROFIT_ENABLED !== "false";
const MAX_ORDERS_PER_RUN = Number(process.env.COPY_LIVE_MAX_ORDERS_PER_RUN ?? "20");

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
  sourcePositionCount?: number;
  noTradeReason?: string | null;
  blockers: string[];
  message: string;
}

type CopyLiveSource = {
  traderId: string;
  sourcePositionKey: string;
  marketId: string;
  side: string;
  entryPrice: number;
  asset: string | null;
  pnl: number;
  size: number;
  avgPrice: number;
  conviction?: number;
  tier?: string;
  lifetime?: number;
  heat?: number;
  confidence?: number;
  uncertainty?: number;
  leaderCount?: number;
  marketCategory?: string | null;
  usMarketSlug?: string | null;
};

async function loadCopyTargetPositions(): Promise<CopyLiveSource[]> {
  const topIds = await loadTopCopyLeaderIds();
  if (topIds.length === 0) return [];

  const traders = await prisma.trader.findMany({
    where: { id: { in: topIds } },
    include: { metricsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const truthById = new Map(
    traders.map((t) => [t.id, buildTraderTruth(t, t.metricsSnapshots[0] ?? null)]),
  );

  const rows = await prisma.position.findMany({
    where: { status: "open", traderId: { in: topIds }, source: "polymarket-us" },
    select: {
      traderId: true,
      externalKey: true,
      marketId: true,
      side: true,
      avgPrice: true,
      asset: true,
      pnl: true,
      size: true,
      market: { select: { title: true, slug: true, category: true, source: true } },
    },
  });

  const leadersByMarket = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = leadersByMarket.get(r.marketId) ?? new Set<string>();
    set.add(r.traderId);
    leadersByMarket.set(r.marketId, set);
  }

  const mapped: CopyLiveSource[] = [];

  for (const r of rows) {
    const truth = truthById.get(r.traderId);
    if (!truth) continue;

    const usSlug = r.market.slug?.trim();
    if (!usSlug || r.market.source !== "polymarket-us") continue;

    const usScore = computeUsWalletScore({ truth, categorySpecialty: r.market.category });
    const entry = evaluateUsLeaderEntryGate({
      score: usScore,
      leaderPnl: r.pnl,
      leaderSize: r.size,
      leaderAvgPrice: r.avgPrice,
    });

    if (!entry.pass) continue;

    const leaderCount = leadersByMarket.get(r.marketId)?.size ?? 1;

    mapped.push({
      traderId: r.traderId,
      sourcePositionKey: r.externalKey,
      marketId: r.marketId,
      side: r.side,
      entryPrice: r.avgPrice,
      asset: r.asset,
      pnl: r.pnl,
      size: r.size,
      avgPrice: r.avgPrice,
      conviction: usScore.rankingScore,
      tier: truth.tier,
      usMarketSlug: usSlug,
      leaderCount,
      marketCategory: r.market.category,
    });
  }

  return mapped;
}

export async function runCopyLiveJob(): Promise<CopyLiveJobSummary> {
  const cfg = getExecutionConfig();
  if (cfg.provider !== "polymarket-us") {
    return {
      enabled: ENABLED,
      ready: false,
      mirrorsPending: 0,
      mirrorsBlocked: 0,
      mirrorsSubmitted: 0,
      mirrorsClosed: 0,
      bankrollUsd: null,
      availableUsd: null,
      deployedUsd: null,
      tradeSizeUsd: null,
      bankrollSource: null,
      usOpenPositions: [],
      blockers: [`EXECUTION_PROVIDER must be polymarket-us (got ${cfg.provider})`],
      message: "live copy rejected — US-only execution required",
    };
  }

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

  const sources: CopyLiveSource[] = USE_PAPER_SOURCE
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

  const copyLeaderIds = USE_PAPER_SOURCE ? [] : await loadTopCopyLeaderIds();
  const sourcePositionCount = sources.length;
  console.log(
    `[worker] live copy leaders=${copyLeaderIds.length} sourcePositions=${sourcePositionCount}`,
  );

  let noTradeReason: string | null = null;
  if (sourcePositionCount === 0) {
    if (copyLeaderIds.length === 0) {
      noTradeReason = "No COPY leaders enabled — tier gates not met.";
    } else {
      noTradeReason = `${copyLeaderIds.length} enabled leader(s) but zero open US positions passed tier entry gates.`;
    }
  }

  if (cfg.provider === "polymarket-us" && readiness.ready) {
    const retryBlocked = await prisma.copyLiveMirror.findMany({
      where: {
        status: "BLOCKED",
        blockReason: { contains: "uncertain match", mode: "insensitive" },
      },
      include: {
        market: { select: { title: true, slug: true, category: true } },
      },
      take: 30,
    });
    for (const mirror of retryBlocked) {
      const usSlug = mirror.usMarketSlug?.trim() || mirror.market.slug?.trim() || null;
      if (usSlug) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: {
            status: "PENDING",
            blockReason: null,
            usMarketSlug: usSlug,
            matchConfidence: 1,
            matchReason: "us-native-market",
          },
        });
      } else {
        await prisma.copyLiveMirror.delete({ where: { id: mirror.id } }).catch(() => undefined);
      }
    }
  }

  const sourceKeys = new Set(sources.map((s) => s.sourcePositionKey));
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

      if (LADDER_CONFIG.enabled && client) {
        await processCopyLiveLadders({ provider, client });
      } else if (TAKE_PROFIT_ENABLED && client && TAKE_PROFIT_PCT > 0) {
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
  const weeklyBefore = await prisma.copyWeeklyRiskState.findUnique({
    where: { id: "current" },
    select: { halted: true, weekKey: true },
  });
  const weekly = await evaluateCopyWeeklyStopLoss(bankroll.bankrollUsd);
  if (weekly.halted && weekly.haltedReason && (!weeklyBefore?.halted || weeklyBefore.weekKey !== weekly.weekKey)) {
    await notifyWeeklyStopRisk({
      weekKey: weekly.weekKey,
      message: weekly.haltedReason,
    });
  }
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

  const tradeSizeUsd = computeConsensusTradeSizeUsd(
    bankroll.bankrollUsd,
    sumOpenExposureUsd(exposureBase),
    1,
    { config: sizing, availableUsd: bankroll.availableUsd },
  );

  for (const src of sources) {
    const deployedNow = sumOpenExposureUsd(exposureBase);
    const leaderCount = src.leaderCount ?? 1;
    const sizeUsd = computeConsensusTradeSizeUsd(
      bankroll.bankrollUsd,
      deployedNow,
      leaderCount,
      {
        config: sizing,
        availableUsd: bankroll.availableUsd,
        sameCategory: Boolean(src.marketCategory),
      },
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

    if (localBlock && isRoutineUsTierSkipReason(localBlock)) {
      if (existing && existing.status !== "OPEN" && existing.status !== "SUBMITTED") {
        await prisma.copyLiveMirror.delete({ where: { id: existing.id } }).catch(() => undefined);
      }
      continue;
    }

    const usSlug = src.usMarketSlug ?? null;

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
          usMarketSlug: usSlug,
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
      take: MAX_ORDERS_PER_RUN,
      include: {
        trader: { select: { address: true } },
        market: { select: { clobTokenIds: true, conditionId: true, slug: true, title: true, category: true } },
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
      const orderSizeUsd = mirror.requestedSizeUsd > 0
        ? mirror.requestedSizeUsd
        : computeConsensusTradeSizeUsd(
            freshBankroll.bankrollUsd,
            deployedNow - mirror.requestedSizeUsd,
            1,
            { config: sizing, availableUsd: freshBankroll.availableUsd },
          );

      if (orderSizeUsd <= 0) {
        await prisma.copyLiveMirror.delete({ where: { id: mirror.id } }).catch(() => undefined);
        continue;
      }

      if (Math.abs(mirror.requestedSizeUsd - orderSizeUsd) >= 0.01) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: { requestedSizeUsd: orderSizeUsd },
        });
      }

      const usSlug = mirror.usMarketSlug?.trim() || mirror.market.slug?.trim() || null;
      if (!usSlug) {
        await prisma.copyLiveMirror.update({
          where: { id: mirror.id },
          data: { status: "BLOCKED", blockReason: "no US market slug" },
        });
        mirrorsBlocked++;
        continue;
      }

      await prisma.copyLiveMirror.update({
        where: { id: mirror.id },
        data: { usMarketSlug: usSlug, matchConfidence: 1, matchReason: "us-native-market" },
      });

      const tokenId = usSlug;
      const usSlugForNotify = usSlug;

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
        await initMirrorLadderState(mirror.id, filledUsd);
        await notifyLiveCopyTrade({
          kind: "filled",
          mirrorId: mirror.id,
          marketTitle: mirror.market.title,
          side: mirror.side,
          sizeUsd: filledUsd,
          entryPrice,
          traderAddress: mirror.trader.address,
          providerOrderId: result.providerOrderId ?? null,
          usMarketSlug: usSlugForNotify,
          usMatchPct: 100,
          reason: "verified EXECUTED fill",
        });
        await notifyJournalDecision({
          key: `enter:${mirror.id}`,
          title: "Trade entry",
          decision: `Opened $${filledUsd.toFixed(2)} on ${mirror.market.title.slice(0, 80)}`,
          context: `Leader ${mirror.trader.address.slice(0, 10)}… · US slug ${usSlugForNotify ?? tokenId ?? "?"}`,
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

  const [mirrorStatusCounts, discordPending] = await Promise.all([
    prisma.copyLiveMirror.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.discordEvent.count({
      where: {
        status: "PENDING",
        dedupeKey: { startsWith: "copy:live:" },
      },
    }),
  ]);
  const statusSummary = mirrorStatusCounts
    .map((r) => `${r.status}=${r._count._all}`)
    .join(" ");
  console.log(
    `[worker] live copy summary mirrors=[${statusSummary}] discordPending=${discordPending} openedThisRun=${mirrorsSubmitted}`,
  );

  if (mirrorsSubmitted === 0 && (mirrorsBlocked > 0 || sources.length > 0)) {
    const blockedRows = await prisma.copyLiveMirror.findMany({
      where: { status: "BLOCKED" },
      select: { blockReason: true },
      take: 200,
    });
    const reasonCounts = new Map<string, number>();
    for (const row of blockedRows) {
      const reason = row.blockReason?.trim() || "unknown";
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => `${count}x ${reason.slice(0, 72)}`);
    if (topReasons.length > 0) {
      console.log(`[worker] live copy top block reasons: ${topReasons.join(" | ")}`);
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
    sourcePositionCount,
    noTradeReason: mirrorsSubmitted === 0 ? noTradeReason : null,
    blockers: readiness.blockers,
    message: blockReason
      ? `live copy blocked: ${blockReason}`
      : `live copy: bankroll=$${bankroll.bankrollUsd.toFixed(0)} deployed=$${finalDeployed.toFixed(0)} nextTrade=$${tradeSizeUsd.toFixed(0)} pending=${mirrorsPending} opened=${mirrorsSubmitted} closed=${mirrorsClosed}`,
  };
}
