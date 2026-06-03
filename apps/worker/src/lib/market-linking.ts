import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  fetchJson,
  gammaMarketByConditionUrl,
  gammaMarketBySlugUrl,
  parseClobTokenIds,
  parseResolutionStatus,
  type DataApiPosition,
  type DataApiTrade,
  type GammaMarketRecord,
} from "./polymarket.js";
import { normalizeMarketCategory } from "@augurium/scoring";
import { storeRawPayload } from "./ingestion-store.js";

export type MarketLinkMethod =
  | "conditionId-db"
  | "conditionId-gamma"
  | "clobTokenId"
  | "slug-db"
  | "slug-gamma"
  | "eventSlug-db"
  | "trade-stub"
  | "position-payload"
  | "already-linked"
  | "unlinked";

export interface MarketLinkHints {
  conditionId: string;
  asset?: string;
  slug?: string | null;
  eventSlug?: string | null;
  title?: string | null;
  eventExternalId?: string | null;
}

export interface LinkStats {
  examined: number;
  linked: number;
  unlinked: number;
  byMethod: Record<string, number>;
  unlinkedReasons: Record<string, number>;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function marketUpsertDataFromGamma(
  market: GammaMarketRecord,
  eventMeta?: { eventId?: string; eventSlug?: string },
): Prisma.MarketCreateInput {
  const { resolved, resolutionStatus } = parseResolutionStatus(
    market.umaResolutionStatuses,
  );
  const tokens = parseClobTokenIds(market.clobTokenIds);
  const event = market.events?.[0];

  return {
    externalId: market.id,
    conditionId: market.conditionId,
    eventExternalId: eventMeta?.eventId ?? event?.id,
    eventSlug: eventMeta?.eventSlug ?? event?.slug,
    source: "polymarket",
    title: market.question ?? market.title ?? "Unknown market",
    slug: market.slug,
    category: normalizeMarketCategory({
      gammaCategory: market.category,
      title: market.question ?? market.title,
      slug: market.slug,
      eventSlug: eventMeta?.eventSlug ?? event?.slug,
    }),
    endDate: market.endDate ? new Date(market.endDate) : null,
    active: (market.active ?? true) && !(market.closed ?? false),
    closed: market.closed ?? false,
    resolved,
    resolutionStatus,
    acceptingOrders: market.acceptingOrders,
    clobTokenIds: tokens,
  };
}

export async function upsertMarketFromGamma(
  market: GammaMarketRecord,
  eventMeta?: { eventId?: string; eventSlug?: string },
): Promise<string> {
  const data = marketUpsertDataFromGamma(market, eventMeta);
  const updateFields = {
    eventExternalId: data.eventExternalId,
    eventSlug: data.eventSlug,
    title: data.title,
    slug: data.slug,
    category: data.category,
    endDate: data.endDate,
    active: data.active,
    closed: data.closed,
    resolved: data.resolved,
    resolutionStatus: data.resolutionStatus,
    acceptingOrders: data.acceptingOrders,
    clobTokenIds: data.clobTokenIds,
    conditionId: market.conditionId,
  };

  const existing = await prisma.market.findFirst({
    where: {
      OR: [
        ...(market.conditionId ? [{ conditionId: market.conditionId }] : []),
        { externalId: market.id },
      ],
    },
  });

  if (existing) {
    const externalIdTaken = await prisma.market.findFirst({
      where: { externalId: market.id, id: { not: existing.id } },
    });
    const row = await prisma.market.update({
      where: { id: existing.id },
      data: externalIdTaken ? updateFields : { ...updateFields, externalId: market.id },
    });
    return row.id;
  }

  const byExternalId = await prisma.market.findUnique({
    where: { externalId: market.id },
    select: { id: true },
  });
  if (byExternalId) {
    return (
      await prisma.market.update({
        where: { id: byExternalId.id },
        data: updateFields,
      })
    ).id;
  }

  try {
    const row = await prisma.market.create({
      data: { ...data, externalId: market.id },
    });
    return row.id;
  } catch (err) {
    const recovered = await recoverMarketFromP2002(market, err);
    if (recovered) return recovered;
    throw err;
  }
}

function isPrismaP2002(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "P2002");
}

async function recoverMarketFromP2002(
  market: GammaMarketRecord,
  err: unknown,
): Promise<string | null> {
  if (!isPrismaP2002(err)) return null;
  const fallback = await prisma.market.findFirst({
    where: {
      OR: [
        { externalId: market.id },
        ...(market.conditionId ? [{ conditionId: market.conditionId }] : []),
      ],
    },
  });
  if (fallback) {
    console.log(
      `[market-linking] P2002 recovered externalId=${market.id} conditionId=${market.conditionId ?? "n/a"} → ${fallback.id}`,
    );
    return fallback.id;
  }
  return null;
}

export async function fetchGammaMarketByConditionId(
  conditionId: string,
): Promise<GammaMarketRecord | null> {
  const url = gammaMarketByConditionUrl(conditionId);
  const rows = await fetchJson<GammaMarketRecord[]>(url);
  await storeRawPayload("polymarket-gamma", url, rows);
  return rows.find((m) => m.conditionId === conditionId) ?? rows[0] ?? null;
}

export async function fetchGammaMarketsBySlug(
  slug: string,
): Promise<GammaMarketRecord[]> {
  const url = gammaMarketBySlugUrl(slug);
  const rows = await fetchJson<GammaMarketRecord[]>(url);
  await storeRawPayload("polymarket-gamma", url, rows);
  return rows;
}

async function findMarketByConditionId(conditionId: string) {
  return prisma.market.findFirst({ where: { conditionId } });
}

async function findMarketByClobToken(asset: string) {
  return prisma.market.findFirst({
    where: { clobTokenIds: { has: asset } },
  });
}

async function findMarketBySlug(slug: string) {
  return prisma.market.findFirst({
    where: { OR: [{ slug }, { eventSlug: slug }] },
  });
}

export async function resolveOrCreateMarket(
  hints: MarketLinkHints,
): Promise<{ marketId: string; method: MarketLinkMethod } | null> {
  const { conditionId } = hints;
  if (!conditionId) return null;

  const existing = await findMarketByConditionId(conditionId);
  if (existing) {
    return { marketId: existing.id, method: "conditionId-db" };
  }

  if (hints.asset) {
    const byToken = await findMarketByClobToken(hints.asset);
    if (byToken) {
      return { marketId: byToken.id, method: "clobTokenId" };
    }
  }

  if (hints.slug) {
    const bySlug = await findMarketBySlug(hints.slug);
    if (bySlug) {
      return { marketId: bySlug.id, method: "slug-db" };
    }
    const gammaBySlug = await fetchGammaMarketsBySlug(hints.slug);
    const match =
      gammaBySlug.find((m) => m.conditionId === conditionId) ??
      gammaBySlug[0];
    if (match) {
      const id = await upsertMarketFromGamma(match);
      return { marketId: id, method: "slug-gamma" };
    }
  }

  if (hints.eventSlug && hints.eventSlug !== hints.slug) {
    const byEventSlug = await findMarketBySlug(hints.eventSlug);
    if (byEventSlug) {
      return { marketId: byEventSlug.id, method: "eventSlug-db" };
    }
  }

  const gamma = await fetchGammaMarketByConditionId(conditionId);
  if (gamma) {
    const id = await upsertMarketFromGamma(gamma, {
      eventSlug: hints.eventSlug ?? undefined,
    });
    return { marketId: id, method: "conditionId-gamma" };
  }

  const existingTokens = hints.asset ? [hints.asset] : [];
  const stub = await prisma.market.upsert({
    where: { conditionId },
    create: {
      externalId: `unresolved-${conditionId}`,
      conditionId,
      eventExternalId: hints.eventExternalId ?? undefined,
      eventSlug: hints.eventSlug ?? undefined,
      source: "polymarket",
      title: hints.title ?? `Market ${conditionId.slice(0, 12)}…`,
      slug: hints.slug ?? undefined,
      active: true,
      closed: false,
      clobTokenIds: existingTokens,
    },
    update: {
      title: hints.title ?? undefined,
      slug: hints.slug ?? undefined,
      eventSlug: hints.eventSlug ?? undefined,
    },
  });

  if (hints.asset && !stub.clobTokenIds.includes(hints.asset)) {
    await prisma.market.update({
      where: { id: stub.id },
      data: { clobTokenIds: [...stub.clobTokenIds, hints.asset] },
    });
  }

  return { marketId: stub.id, method: "trade-stub" };
}

export function hintsFromTrade(trade: {
  conditionId: string;
  asset: string;
  slug?: string | null;
  eventSlug?: string | null;
  outcome?: string | null;
}): MarketLinkHints {
  return {
    conditionId: trade.conditionId,
    asset: trade.asset,
    slug: trade.slug,
    eventSlug: trade.eventSlug,
    title: trade.outcome ? `${trade.outcome}` : undefined,
  };
}

export function hintsFromDataTrade(t: DataApiTrade): MarketLinkHints {
  return {
    conditionId: t.conditionId,
    asset: t.asset,
    slug: t.slug ?? null,
    eventSlug: t.eventSlug ?? null,
    title: t.title ?? null,
  };
}

export function hintsFromPosition(pos: DataApiPosition): MarketLinkHints {
  return {
    conditionId: pos.conditionId,
    asset: pos.asset,
    slug: pos.slug ?? null,
    eventSlug: pos.eventSlug ?? null,
    title: pos.title ?? null,
    eventExternalId: pos.eventId ?? null,
  };
}

export async function linkSingleTrade(tradeId: string): Promise<MarketLinkMethod> {
  const trade = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
  if (trade.marketId) return "already-linked";

  const resolved = await resolveOrCreateMarket(hintsFromTrade(trade));
  if (!resolved) {
    return "unlinked";
  }

  await prisma.trade.update({
    where: { id: tradeId },
    data: { marketId: resolved.marketId },
  });
  return resolved.method;
}

export async function backfillTradeMarketLinks(
  batchSize = Number(process.env.TRADE_LINK_BATCH_SIZE ?? "500"),
): Promise<LinkStats> {
  const stats: LinkStats = {
    examined: 0,
    linked: 0,
    unlinked: 0,
    byMethod: {},
    unlinkedReasons: {},
  };

  const unlinked = await prisma.trade.findMany({
    where: { marketId: null },
    take: batchSize,
    orderBy: { tradedAt: "desc" },
  });

  for (const trade of unlinked) {
    stats.examined++;
    const method = await linkSingleTrade(trade.id);
    bump(stats.byMethod, method);
    if (method === "unlinked") {
      stats.unlinked++;
      bump(stats.unlinkedReasons, "no-market-match");
    } else {
      stats.linked++;
    }
  }

  return stats;
}

export async function ensureMarketForPosition(
  pos: DataApiPosition,
): Promise<{ marketId: string; method: MarketLinkMethod }> {
  const resolved = await resolveOrCreateMarket(hintsFromPosition(pos));
  if (resolved) return resolved;

  try {
    const created = await prisma.market.create({
      data: {
        externalId: pos.conditionId,
        conditionId: pos.conditionId,
        eventExternalId: pos.eventId,
        eventSlug: pos.eventSlug,
        title: pos.title ?? `Market ${pos.conditionId.slice(0, 12)}…`,
        slug: pos.slug,
        source: "polymarket",
        active: true,
        clobTokenIds: pos.asset ? [pos.asset] : [],
      },
    });
    return { marketId: created.id, method: "position-payload" };
  } catch (err) {
    if (isPrismaP2002(err)) {
      const existing = await prisma.market.findFirst({
        where: {
          OR: [{ conditionId: pos.conditionId }, { externalId: pos.conditionId }],
        },
      });
      if (existing) {
        console.log(
          `[market-linking] P2002 recovered position market conditionId=${pos.conditionId} → ${existing.id}`,
        );
        return { marketId: existing.id, method: "position-payload" };
      }
    }
    throw err;
  }
}
