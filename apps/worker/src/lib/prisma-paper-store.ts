import { prisma } from "@augurium/database";
import type { ProviderBalance } from "@augurium/execution";
import {
  oppositeSide,
  type PaperOrderRecord,
  type PaperPositionRecord,
  type PaperStore,
} from "@augurium/execution";

export class PrismaPaperStore implements PaperStore {
  async getBalance(): Promise<ProviderBalance> {
    const state = await prisma.portfolioState.findUnique({ where: { id: "current" } });
    const available = state?.availableCapital ?? 70;
    return { availableUsd: available, totalUsd: state?.accountValue ?? available };
  }

  async getOpenPositions(): Promise<PaperPositionRecord[]> {
    const rows = await prisma.executionPosition.findMany({ where: { status: "OPEN" } });
    return rows.map((r) => ({
      id: r.id,
      signalId: r.signalId ?? "",
      marketId: r.marketId,
      side: r.side,
      sizeUsd: r.sizeUsd,
      entryPrice: r.entryPrice,
      currentPrice: r.currentPrice,
      positionRemaining: r.positionRemaining,
      partialExitDone: r.partialExitDone,
      runnerActive: r.runnerActive,
      status: r.status,
      realizedPnl: r.realizedPnl,
    }));
  }

  async getOpenOrders(): Promise<PaperOrderRecord[]> {
    const rows = await prisma.executionOrder.findMany({
      where: { status: { in: ["SUBMITTED", "PARTIAL"] }, provider: "paper" },
    });
    return rows.map(mapOrder);
  }

  async findOrderByIdempotency(key: string): Promise<PaperOrderRecord | null> {
    const row = await prisma.executionOrder.findUnique({ where: { idempotencyKey: key } });
    return row ? mapOrder(row) : null;
  }

  async findOpenPosition(
    marketId: string,
    side: string,
  ): Promise<PaperPositionRecord | null> {
    const row = await prisma.executionPosition.findFirst({
      where: { marketId, side, status: "OPEN", provider: "paper" },
    });
    return row ? mapPosition(row) : null;
  }

  async findOppositePosition(
    marketId: string,
    side: string,
  ): Promise<PaperPositionRecord | null> {
    return this.findOpenPosition(marketId, oppositeSide(side));
  }

  async createOrder(record: PaperOrderRecord): Promise<void> {
    await prisma.executionOrder.create({
      data: {
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        signalId: record.signalId,
        provider: "paper",
        mode: "PAPER",
        marketId: record.marketId,
        side: record.side,
        orderType: "LIMIT",
        requestedSizeUsd: record.requestedSizeUsd,
        requestedPrice: record.requestedPrice,
        status: record.status,
        providerOrderId: record.providerOrderId,
        fillPrice: record.fillPrice,
        filledSizeUsd: record.filledSizeUsd,
      },
    });
  }

  async updateOrder(id: string, patch: Partial<PaperOrderRecord>): Promise<void> {
    await prisma.executionOrder.update({
      where: { id },
      data: {
        status: patch.status,
        fillPrice: patch.fillPrice,
        filledSizeUsd: patch.filledSizeUsd,
      },
    });
  }

  async createPosition(record: PaperPositionRecord): Promise<void> {
    await prisma.executionPosition.create({
      data: {
        id: record.id,
        signalId: record.signalId,
        marketId: record.marketId,
        side: record.side,
        provider: "paper",
        sizeUsd: record.sizeUsd,
        entryPrice: record.entryPrice,
        currentPrice: record.currentPrice,
        positionRemaining: record.positionRemaining,
        partialExitDone: record.partialExitDone,
        runnerActive: record.runnerActive,
        status: record.status,
        providerPositionId: record.id,
      },
    });
  }

  async updatePosition(id: string, patch: Partial<PaperPositionRecord>): Promise<void> {
    await prisma.executionPosition.update({
      where: { id },
      data: {
        positionRemaining: patch.positionRemaining,
        partialExitDone: patch.partialExitDone,
        runnerActive: patch.runnerActive,
        status: patch.status,
        currentPrice: patch.currentPrice,
        realizedPnl: patch.realizedPnl,
        closedAt: patch.status === "CLOSED" ? new Date() : undefined,
      },
    });
  }

  async getPosition(id: string): Promise<PaperPositionRecord | null> {
    const row = await prisma.executionPosition.findUnique({ where: { id } });
    return row ? mapPosition(row) : null;
  }

  async resolveFillPrice(
    marketId: string,
    side: string,
    requestedPrice: number,
  ): Promise<number> {
    const trade = await prisma.trade.findFirst({
      where: { marketId },
      orderBy: { tradedAt: "desc" },
      select: { price: true },
    });
    if (trade?.price) return trade.price;
    const shadow = await prisma.shadowTrade.findFirst({
      where: { marketId },
      orderBy: { updatedAt: "desc" },
      select: { currentPrice: true },
    });
    if (shadow?.currentPrice) return shadow.currentPrice;
    return requestedPrice;
  }
}

function mapOrder(row: {
  id: string;
  idempotencyKey: string;
  signalId: string;
  marketId: string;
  side: string;
  status: string;
  requestedSizeUsd: number;
  requestedPrice: number | null;
  fillPrice: number | null;
  filledSizeUsd: number;
  providerOrderId: string | null;
}): PaperOrderRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    signalId: row.signalId,
    marketId: row.marketId,
    side: row.side,
    status: row.status,
    requestedSizeUsd: row.requestedSizeUsd,
    requestedPrice: row.requestedPrice ?? 0.5,
    fillPrice: row.fillPrice ?? undefined,
    filledSizeUsd: row.filledSizeUsd,
    providerOrderId: row.providerOrderId ?? row.id,
  };
}

function mapPosition(row: {
  id: string;
  signalId: string | null;
  marketId: string;
  side: string;
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  positionRemaining: number;
  partialExitDone: boolean;
  runnerActive: boolean;
  status: string;
  realizedPnl: number;
}): PaperPositionRecord {
  return {
    id: row.id,
    signalId: row.signalId ?? "",
    marketId: row.marketId,
    side: row.side,
    sizeUsd: row.sizeUsd,
    entryPrice: row.entryPrice,
    currentPrice: row.currentPrice,
    positionRemaining: row.positionRemaining,
    partialExitDone: row.partialExitDone,
    runnerActive: row.runnerActive,
    status: row.status,
    realizedPnl: row.realizedPnl,
  };
}
