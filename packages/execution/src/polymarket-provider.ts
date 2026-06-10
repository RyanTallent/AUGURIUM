import { getExecutionConfig, isLivePolymarketEnabled } from "./config.js";
import { AssetType } from "@polymarket/clob-client-v2";
import {
  getPolymarketClobClient,
  mapOutcomeSideToClob,
  OrderType,
  validateClobConnection,
} from "./polymarket-clob.js";
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

function clobReadyFlag(): boolean {
  const v = process.env.POLYMARKET_CLOB_READY;
  return v === "true" || v === "1" || v === "yes";
}

function useMarketOrders(): boolean {
  return process.env.COPY_LIVE_ORDER_TYPE !== "limit";
}

export class PolymarketExecutionProvider implements ExecutionProvider {
  readonly name = "polymarket" as const;
  readonly mode = "LIVE" as const;
  readonly chainId = 137;

  async healthCheck(): Promise<ProviderHealth> {
    const cred = await this.validateCredentials();
    const cfg = getExecutionConfig();
    const live = isLivePolymarketEnabled(cfg);
    const clobReady = clobReadyFlag();
    if (!cred.valid || !live || !clobReady) {
      return {
        ok: false,
        ready: clobReady,
        provider: "polymarket",
        message: cred.message,
      };
    }
    const ping = await validateClobConnection();
    return {
      ok: ping.ok,
      ready: ping.ok,
      provider: "polymarket",
      message: ping.message,
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

    if (!clobReadyFlag()) {
      return {
        valid: true,
        configured: true,
        message: "Credentials set — set POLYMARKET_CLOB_READY=true to enable orders",
      };
    }

    const ping = await validateClobConnection();
    return {
      valid: ping.ok,
      configured: true,
      message: ping.message,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    const client = await getPolymarketClobClient();
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const usd = Number(bal.balance ?? 0) / 1_000_000;
    return { availableUsd: usd, totalUsd: usd };
  }

  async getOpenPositions(): Promise<ProviderPosition[]> {
    const client = await getPolymarketClobClient();
    const orders = await client.getOpenOrders(undefined, true);
    return orders.map((o) => ({
      id: o.id,
      marketId: o.market ?? o.asset_id ?? o.id,
      side: o.side,
      sizeUsd: Number(o.original_size ?? 0) * Number(o.price ?? 0),
      entryPrice: Number(o.price ?? 0),
      currentPrice: Number(o.price ?? 0),
      status: o.status ?? "OPEN",
    }));
  }

  async getOpenOrders(): Promise<ProviderOrder[]> {
    const client = await getPolymarketClobClient();
    const orders = await client.getOpenOrders(undefined, true);
    return orders.map((o) => ({
      id: o.id,
      marketId: o.market ?? o.asset_id ?? o.id,
      side: o.side,
      status: o.status ?? "OPEN",
      requestedSizeUsd: Number(o.original_size ?? 0) * Number(o.price ?? 0),
      filledSizeUsd: Number(o.size_matched ?? 0) * Number(o.price ?? 0),
    }));
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    if (!clobReadyFlag()) {
      return {
        success: false,
        status: "BLOCKED",
        errorMessage: "POLYMARKET_CLOB_READY is false",
      };
    }

    const tokenID = request.asset?.trim();
    if (!tokenID) {
      return {
        success: false,
        status: "FAILED",
        errorMessage: "Missing token asset id for Polymarket order",
      };
    }

    try {
      const client = await getPolymarketClobClient();
      const side = mapOutcomeSideToClob(request.side);
      const tickSize = await client.getTickSize(tokenID);
      const negRisk = await client.getNegRisk(tokenID);
      const options = { tickSize, negRisk };

      let response: { orderID?: string; status?: string; errorMsg?: string };

      if (useMarketOrders()) {
        response = await client.createAndPostMarketOrder(
          {
            tokenID,
            amount: request.requestedSizeUsd,
            side,
            orderType: OrderType.FOK,
          },
          options,
          OrderType.FOK,
        );
      } else {
        const price = Math.min(0.99, Math.max(0.01, request.requestedPrice ?? 0.5));
        const size = Math.max(1, Math.round(request.requestedSizeUsd / price));
        response = await client.createAndPostOrder(
          {
            tokenID,
            price,
            size,
            side,
          },
          options,
          OrderType.GTC,
        );
      }

      const orderId = (response as { orderID?: string })?.orderID;
      const ok = Boolean(orderId) && !response?.errorMsg;
      return {
        success: ok,
        providerOrderId: orderId,
        status: ok ? "SUBMITTED" : "FAILED",
        filledSizeUsd: ok ? request.requestedSizeUsd : 0,
        errorMessage: ok ? undefined : safeLogMessage(response?.errorMsg ?? "order rejected"),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "placeOrder failed";
      return {
        success: false,
        status: "FAILED",
        errorMessage: safeLogMessage(message),
      };
    }
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      const client = await getPolymarketClobClient();
      await client.cancelOrder({ orderID: orderId });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : "cancel failed",
      };
    }
  }

  async closePosition(
    _positionId: string,
    _fraction?: number,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    return {
      success: false,
      errorMessage: "closePosition not implemented — cancel open orders manually for now",
    };
  }

  async syncPortfolio(): Promise<PortfolioSyncResult> {
    try {
      const balance = await this.getBalance();
      const positions = await this.getOpenPositions();
      const orders = await this.getOpenOrders();
      return {
        balance,
        positions,
        orders,
        mismatch: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "sync failed";
      return {
        balance: { availableUsd: 0, totalUsd: 0 },
        positions: [],
        orders: [],
        mismatch: true,
        mismatchDetails: [message],
      };
    }
  }
}
