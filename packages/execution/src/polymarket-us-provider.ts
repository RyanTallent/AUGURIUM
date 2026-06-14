import type { OrderIntent, OrderType as UsOrderType, TimeInForce } from "polymarket-us";
import { getExecutionConfig, isLivePolymarketEnabled } from "./config.js";
import {
  getPolymarketUsClient,
  isPolymarketUsReady,
  validatePolymarketUsConnection,
} from "./polymarket-us-client.js";
import { verifyUsOrderFill } from "./polymarket-us-order-verify.js";
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

function mapSideToUsIntent(side: string): OrderIntent {
  const s = side.toUpperCase();
  if (s === "NO" || s === "SHORT" || s === "SELL") return "ORDER_INTENT_BUY_SHORT";
  return "ORDER_INTENT_BUY_LONG";
}

function useMarketOrders(): boolean {
  return process.env.COPY_LIVE_ORDER_TYPE !== "limit";
}

export class PolymarketUsExecutionProvider implements ExecutionProvider {
  readonly name = "polymarket-us" as const;
  readonly mode = "LIVE" as const;
  readonly chainId = 0;

  async healthCheck(): Promise<ProviderHealth> {
    const cred = await this.validateCredentials();
    const cfg = getExecutionConfig();
    const live = isLivePolymarketEnabled(cfg);
    const ready = isPolymarketUsReady();
    if (!cred.valid || !live || !ready) {
      return {
        ok: false,
        ready,
        provider: "polymarket-us",
        message: cred.message,
      };
    }
    const ping = await validatePolymarketUsConnection();
    return {
      ok: ping.ok,
      ready: ping.ok,
      provider: "polymarket-us",
      message: ping.message,
    };
  }

  async validateCredentials(): Promise<CredentialValidation> {
    const cfg = getExecutionConfig();
    const configured = cfg.hasUsKeyId && cfg.hasUsSecretKey;

    if (!configured) {
      return {
        valid: false,
        configured: false,
        message: "Missing POLYMARKET_US_KEY_ID or POLYMARKET_US_SECRET_KEY",
      };
    }

    if (!isPolymarketUsReady()) {
      return {
        valid: true,
        configured: true,
        message: "US API keys set — set POLYMARKET_US_READY=true to enable orders",
      };
    }

    const ping = await validatePolymarketUsConnection();
    return {
      valid: ping.ok,
      configured: true,
      message: ping.message,
    };
  }

  async getBalance(): Promise<ProviderBalance> {
    const client = getPolymarketUsClient();
    const res = await client.account.balances();
    const balance = res.balances[0];
    const available = balance?.buyingPower ?? balance?.currentBalance ?? 0;
    const total = balance?.currentBalance ?? available;
    return { availableUsd: Number(available), totalUsd: Number(total) };
  }

  async getOpenPositions(): Promise<ProviderPosition[]> {
    const client = getPolymarketUsClient();
    const res = await client.portfolio.positions();
    return Object.entries(res.positions ?? {})
      .filter(([, pos]) => Math.abs(Number(pos.netPosition ?? 0)) > 0)
      .map(([slug, pos]) => ({
        id: slug,
        marketId: slug,
        side: Number(pos.netPosition) >= 0 ? "LONG" : "SHORT",
        sizeUsd: Number(pos.cashValue?.value ?? pos.cost?.value ?? 0),
        entryPrice: 0,
        currentPrice: 0,
        status: pos.expired ? "EXPIRED" : "OPEN",
      }));
  }

  async getOpenOrders(): Promise<ProviderOrder[]> {
    const client = getPolymarketUsClient();
    const res = await client.orders.list();
    return (res.orders ?? []).map((o) => ({
      id: o.id,
      marketId: o.marketSlug,
      side: o.intent,
      status: o.state,
      requestedSizeUsd: Number(o.cashOrderQty?.value ?? 0) || o.quantity * Number(o.price?.value ?? 0),
      filledSizeUsd: o.cumQuantity * Number(o.avgPx?.value ?? o.price?.value ?? 0),
    }));
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    if (!isPolymarketUsReady()) {
      return {
        success: false,
        status: "BLOCKED",
        errorMessage: "POLYMARKET_US_READY is false",
      };
    }

    const marketSlug = request.asset?.trim();
    if (!marketSlug) {
      return {
        success: false,
        status: "FAILED",
        errorMessage: "Missing US market slug for Polymarket US order",
      };
    }

    try {
      const client = getPolymarketUsClient();
      const intent = mapSideToUsIntent(request.side);
      const type: UsOrderType = useMarketOrders() ? "ORDER_TYPE_MARKET" : "ORDER_TYPE_LIMIT";
      const tif: TimeInForce = useMarketOrders()
        ? "TIME_IN_FORCE_FILL_OR_KILL"
        : "TIME_IN_FORCE_GOOD_TILL_CANCEL";

      const params = {
        marketSlug,
        intent,
        type,
        tif,
        synchronousExecution: true,
        manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC" as const,
        ...(useMarketOrders()
          ? {
              cashOrderQty: {
                value: request.requestedSizeUsd.toFixed(2),
                currency: "USD" as const,
              },
            }
          : {
              price: {
                value: Math.min(0.99, Math.max(0.01, request.requestedPrice ?? 0.5)).toFixed(2),
                currency: "USD" as const,
              },
              quantity: Math.max(1, Math.round(request.requestedSizeUsd / (request.requestedPrice ?? 0.5))),
            }),
      };

      const response = await client.orders.create(params);
      if (!response.id) {
        return {
          success: false,
          status: "FAILED",
          errorMessage: "US order rejected (no order id)",
        };
      }

      return verifyUsOrderFill(
        client,
        response.id,
        marketSlug,
        response.executions as Parameters<typeof verifyUsOrderFill>[3],
        useMarketOrders(),
      );
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
      const client = getPolymarketUsClient();
      const order = await client.orders.retrieve(orderId);
      await client.orders.cancel(orderId, { marketSlug: order.order.marketSlug });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : "cancel failed",
      };
    }
  }

  async closePosition(
    positionId: string,
    fraction?: number,
  ): Promise<{ success: boolean; fillPrice?: number; errorMessage?: string }> {
    try {
      const client = getPolymarketUsClient();
      const marketSlug = positionId;

      if (fraction != null && fraction > 0 && fraction < 0.999) {
        const res = await client.portfolio.positions({ market: marketSlug });
        const pos = res.positions?.[marketSlug];
        if (!pos) {
          return { success: false, errorMessage: "no US position to reduce" };
        }
        const cashValue = Number(pos.cashValue?.value ?? pos.cost?.value ?? 0);
        if (cashValue <= 0) {
          return { success: false, errorMessage: "US position has zero notional" };
        }
        const sellUsd = Math.max(0.5, cashValue * fraction);
        const net = Number(pos.netPosition ?? 0);
        const intent =
          net >= 0 ? "ORDER_INTENT_SELL_LONG" : "ORDER_INTENT_SELL_SHORT";

        const response = await client.orders.create({
          marketSlug,
          intent,
          type: "ORDER_TYPE_MARKET",
          tif: "TIME_IN_FORCE_FILL_OR_KILL",
          synchronousExecution: true,
          manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
          cashOrderQty: { value: sellUsd.toFixed(2), currency: "USD" },
        });

        if (!response.id) {
          return { success: false, errorMessage: "partial sell rejected (no order id)" };
        }

        const verified = await verifyUsOrderFill(
          client,
          response.id,
          marketSlug,
          response.executions as Parameters<typeof verifyUsOrderFill>[3],
          true,
        );
        return {
          success: verified.success,
          fillPrice: verified.fillPrice,
          errorMessage: verified.errorMessage,
        };
      }

      await client.orders.closePosition({
        marketSlug,
        synchronousExecution: true,
        manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : "close failed",
      };
    }
  }

  async syncPortfolio(): Promise<PortfolioSyncResult> {
    try {
      const balance = await this.getBalance();
      const positions = await this.getOpenPositions();
      const orders = await this.getOpenOrders();
      return { balance, positions, orders, mismatch: false };
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
