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

/** Replay mode — reads historical replay snapshots; no live orders. */
export class ReplayExecutionProvider implements ExecutionProvider {
  readonly name = "replay" as const;
  readonly mode = "REPLAY" as const;

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      ready: true,
      provider: "replay",
      message: "Replay provider ready (no live orders)",
    };
  }

  async validateCredentials(): Promise<CredentialValidation> {
    return {
      valid: true,
      message: "Replay mode does not use credentials",
      configured: false,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    return { availableUsd: 0, totalUsd: 0 };
  }

  async getOpenPositions(): Promise<ProviderPosition[]> {
    return [];
  }

  async getOpenOrders(): Promise<ProviderOrder[]> {
    return [];
  }

  async placeOrder(_request: OrderRequest): Promise<OrderResult> {
    return {
      success: false,
      status: "BLOCKED",
      errorMessage: "Replay provider does not place orders — use paper for testing",
    };
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean; errorMessage?: string }> {
    return { success: true };
  }

  async closePosition(
    _positionId: string,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    return { success: false, errorMessage: "Replay close not implemented" };
  }

  async syncPortfolio(): Promise<PortfolioSyncResult> {
    return {
      balance: { availableUsd: 0, totalUsd: 0 },
      positions: [],
      orders: [],
      mismatch: false,
    };
  }
}
