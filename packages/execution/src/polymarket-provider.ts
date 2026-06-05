import { getExecutionConfig, isLivePolymarketEnabled } from "./config.js";

function clobReadyFlag(): boolean {
  const v = process.env.POLYMARKET_CLOB_READY;
  return v === "true" || v === "1" || v === "yes";
}
import { safeLogMessage } from "./redact.js";
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

const NOT_READY_MSG =
  "Polymarket CLOB live execution is NOT_READY — install @polymarket/clob-client and complete credential wiring before enabling LIVE_TRADING_ENABLED";

export class PolymarketExecutionProvider implements ExecutionProvider {
  readonly name = "polymarket" as const;
  readonly mode = "LIVE" as const;
  readonly chainId = 137;

  async healthCheck(): Promise<ProviderHealth> {
    const cred = await this.validateCredentials();
    const cfg = getExecutionConfig();
    const live = isLivePolymarketEnabled(cfg);
    const clobReady = clobReadyFlag();
    return {
      ok: cred.valid && live && clobReady,
      ready: clobReady,
      provider: "polymarket",
      message: cred.valid
        ? live
          ? clobReady
            ? "Live gates on — CLOB ready flag set"
            : NOT_READY_MSG
          : "Credentials present but live trading gates are off"
        : cred.message,
    };
  }

  async validateCredentials(): Promise<CredentialValidation> {
    const cfg = getExecutionConfig();
    const configured =
      cfg.hasPrivateKey &&
      cfg.hasApiKey &&
      cfg.hasApiSecret &&
      cfg.hasApiPassphrase &&
      cfg.hasFunderAddress;

    if (!configured) {
      return {
        valid: false,
        configured: false,
        message:
          "Missing one or more: POLYMARKET_PRIVATE_KEY, API_KEY, API_SECRET, API_PASSPHRASE, FUNDER_ADDRESS",
      };
    }

    if (cfg.hasPrivateKey && process.env.POLYMARKET_PRIVATE_KEY!.length < 32) {
      return {
        valid: false,
        configured: true,
        message: "Private key appears invalid (never logged)",
      };
    }

    return {
      valid: true,
      configured: true,
      message: "Credentials configured (not validated against CLOB — provider NOT_READY)",
    };
  }

  private notReady(): never {
    throw new Error(NOT_READY_MSG);
  }

  async getBalance(): Promise<ProviderBalance> {
    await this.validateCredentials();
    this.notReady();
  }

  async getOpenPositions(): Promise<ProviderPosition[]> {
    this.notReady();
  }

  async getOpenOrders(): Promise<ProviderOrder[]> {
    this.notReady();
  }

  async placeOrder(_request: OrderRequest): Promise<OrderResult> {
    return {
      success: false,
      status: "FAILED",
      errorMessage: safeLogMessage(NOT_READY_MSG),
    };
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean; errorMessage?: string }> {
    return { success: false, errorMessage: NOT_READY_MSG };
  }

  async closePosition(
    _positionId: string,
    _fraction?: number,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    return { success: false, errorMessage: NOT_READY_MSG };
  }

  async syncPortfolio(): Promise<PortfolioSyncResult> {
    const cred = await this.validateCredentials();
    return {
      balance: { availableUsd: 0, totalUsd: 0 },
      positions: [],
      orders: [],
      mismatch: !cred.valid,
      mismatchDetails: cred.valid ? [NOT_READY_MSG] : [cred.message],
    };
  }
}
