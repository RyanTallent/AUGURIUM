import type {
  CredentialValidation,
  ExecutionProvider,
  OrderRequest,
  OrderResult,
  PortfolioSyncResult,
  ProviderBalance,
  ProviderHealth,
  ProviderOrder,
  ProviderPosition,
} from "./types.js";
import type { PaperStore } from "./paper-store.js";

export class PaperExecutionProvider implements ExecutionProvider {
  readonly name = "paper" as const;
  readonly mode = "PAPER" as const;

  constructor(private readonly store: PaperStore) {}

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      ready: true,
      provider: "paper",
      message: "Paper execution provider ready",
    };
  }

  async validateCredentials(): Promise<CredentialValidation> {
    return {
      valid: true,
      message: "Paper mode does not require credentials",
      configured: true,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    return this.store.getBalance();
  }

  async getOpenPositions(): Promise<ProviderPosition[]> {
    const rows = await this.store.getOpenPositions();
    return rows.map((p) => ({
      id: p.id,
      marketId: p.marketId,
      side: p.side,
      sizeUsd: p.sizeUsd,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      status: p.status,
    }));
  }

  async getOpenOrders(): Promise<ProviderOrder[]> {
    const rows = await this.store.getOpenOrders();
    return rows.map((o) => ({
      id: o.id,
      marketId: o.marketId,
      side: o.side,
      status: o.status,
      requestedSizeUsd: o.requestedSizeUsd,
      filledSizeUsd: o.filledSizeUsd,
    }));
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    const existing = await this.store.findOrderByIdempotency(request.idempotencyKey);
    if (existing) {
      return {
        success: true,
        providerOrderId: existing.providerOrderId,
        status: existing.status as OrderResult["status"],
        fillPrice: existing.fillPrice,
        filledSizeUsd: existing.filledSizeUsd,
      };
    }

    const dup = await this.store.findOpenPosition(request.marketId, request.side);
    if (dup) {
      return {
        success: false,
        status: "BLOCKED",
        errorMessage: "duplicate open position for market+side",
      };
    }

    const conflict = await this.store.findOppositePosition(request.marketId, request.side);
    if (conflict) {
      return {
        success: false,
        status: "BLOCKED",
        errorMessage: "conflicting opposite side position",
      };
    }

    const price =
      request.requestedPrice ??
      (await this.store.resolveFillPrice(
        request.marketId,
        request.side,
        0.5,
      ));
    const orderId = `paper-${request.idempotencyKey}`;
    const fillSize = request.requestedSizeUsd;

    await this.store.createOrder({
      id: orderId,
      idempotencyKey: request.idempotencyKey,
      signalId: request.signalId,
      marketId: request.marketId,
      side: request.side,
      status: "FILLED",
      requestedSizeUsd: request.requestedSizeUsd,
      requestedPrice: price,
      fillPrice: price,
      filledSizeUsd: fillSize,
      providerOrderId: orderId,
    });

    await this.store.createPosition({
      id: `pos-${orderId}`,
      signalId: request.signalId,
      marketId: request.marketId,
      side: request.side,
      sizeUsd: fillSize,
      entryPrice: price,
      currentPrice: price,
      positionRemaining: 1,
      partialExitDone: false,
      runnerActive: false,
      status: "OPEN",
      realizedPnl: 0,
    });

    return {
      success: true,
      providerOrderId: orderId,
      status: "FILLED",
      fillPrice: price,
      filledSizeUsd: fillSize,
      partial: false,
    };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; errorMessage?: string }> {
    await this.store.updateOrder(orderId, { status: "CANCELLED" });
    return { success: true };
  }

  async closePosition(
    positionId: string,
    fraction = 1,
  ): Promise<{ success: boolean; fillPrice?: number; errorMessage?: string }> {
    const pos = await this.store.getPosition(positionId);
    if (!pos || pos.status !== "OPEN") {
      return { success: false, errorMessage: "position not open" };
    }
    const price = await this.store.resolveFillPrice(pos.marketId, pos.side, pos.currentPrice);
    const closeUsd = pos.sizeUsd * pos.positionRemaining * fraction;
    const remaining = Math.max(0, pos.positionRemaining - fraction);
    const closed = remaining <= 0.001;

    await this.store.updatePosition(positionId, {
      positionRemaining: closed ? 0 : remaining,
      currentPrice: price,
      status: closed ? "CLOSED" : "OPEN",
      partialExitDone: fraction < 1 || pos.partialExitDone,
      runnerActive: !closed && remaining <= 0.16,
    });

    return { success: true, fillPrice: price };
  }

  async syncPortfolio(): Promise<PortfolioSyncResult> {
    const balance = await this.getBalance();
    const positions = await this.getOpenPositions();
    const orders = await this.getOpenOrders();
    return { balance, positions, orders, mismatch: false };
  }
}
