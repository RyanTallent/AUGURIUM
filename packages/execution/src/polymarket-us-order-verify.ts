import type { PolymarketUS } from "polymarket-us";
import type { OrderResult } from "./types.js";

const DEAD_STATES = new Set([
  "ORDER_STATE_REJECTED",
  "ORDER_STATE_CANCELED",
  "ORDER_STATE_EXPIRED",
]);

type UsOrder = {
  state: string;
  cumQuantity: number;
  avgPx?: { value: string };
  price?: { value: string };
  marketSlug: string;
};

type UsExecution = {
  type: string;
  orderRejectReason?: string;
  order?: UsOrder;
};

function filledUsdFromOrder(order: UsOrder): number {
  const px = Number(order.avgPx?.value ?? order.price?.value ?? 0);
  return order.cumQuantity * px;
}

function hasFillExecution(executions: UsExecution[] | undefined): boolean {
  return (executions ?? []).some(
    (e) => e.type === "EXECUTION_TYPE_FILL" || e.type === "EXECUTION_TYPE_PARTIAL_FILL",
  );
}

export async function hasUsPositionOnMarket(
  client: PolymarketUS,
  marketSlug: string,
): Promise<{ ok: boolean; sizeUsd: number }> {
  const res = await client.portfolio.positions({ market: marketSlug });
  const pos = res.positions?.[marketSlug];
  if (!pos) return { ok: false, sizeUsd: 0 };
  const net = Math.abs(Number(pos.netPosition ?? 0));
  if (net <= 0) return { ok: false, sizeUsd: 0 };
  const sizeUsd = Number(pos.cashValue?.value ?? pos.cost?.value ?? 0);
  return { ok: true, sizeUsd };
}

/** Confirm Polymarket US order actually filled before treating copy as success. */
export async function verifyUsOrderFill(
  client: PolymarketUS,
  orderId: string,
  marketSlug: string,
  createExecutions?: UsExecution[],
  requireFullFill = false,
): Promise<OrderResult> {
  let order: UsOrder | undefined = createExecutions?.find((e) => e.order)?.order;

  try {
    const retrieved = await client.orders.retrieve(orderId);
    order = retrieved.order;
  } catch {
    if (!order) {
      return {
        success: false,
        providerOrderId: orderId,
        status: "FAILED",
        errorMessage: "could not retrieve US order after create",
      };
    }
  }

  const cumQty = order.cumQuantity ?? 0;
  const filledUsd = filledUsdFromOrder(order);
  const fillPrice = Number(order.avgPx?.value ?? order.price?.value ?? 0);
  const executionFill = hasFillExecution(createExecutions);

  const fullyFilled = order.state === "ORDER_STATE_FILLED" && cumQty > 0;
  const partiallyFilled =
    order.state === "ORDER_STATE_PARTIALLY_FILLED" && cumQty > 0 && (executionFill || cumQty > 0);
  const orderFilled = requireFullFill
    ? fullyFilled
    : fullyFilled || partiallyFilled || (executionFill && cumQty > 0);

  let positionOk = false;
  let positionSizeUsd = 0;
  if (!orderFilled) {
    const position = await hasUsPositionOnMarket(client, marketSlug);
    positionOk = position.ok;
    positionSizeUsd = position.sizeUsd;
  }

  if (orderFilled || (!requireFullFill && positionOk)) {
    const sizeUsd = filledUsd > 0 ? filledUsd : positionSizeUsd;
    return {
      success: true,
      providerOrderId: orderId,
      status: order.state === "ORDER_STATE_PARTIALLY_FILLED" ? "PARTIAL" : "FILLED",
      fillPrice: fillPrice > 0 ? fillPrice : undefined,
      filledSizeUsd: sizeUsd > 0 ? sizeUsd : undefined,
      partial: order.state === "ORDER_STATE_PARTIALLY_FILLED",
    };
  }

  const rejectReason = createExecutions?.find((e) => e.orderRejectReason)?.orderRejectReason;
  const stateMsg = requireFullFill && order.state === "ORDER_STATE_PARTIALLY_FILLED"
    ? "market FOK order partially filled (treated as failure)"
    : DEAD_STATES.has(order.state)
      ? `order ${order.state}`
      : `order not filled (state=${order.state})`;

  return {
    success: false,
    providerOrderId: orderId,
    status: DEAD_STATES.has(order.state) ? "FAILED" : "CANCELLED",
    errorMessage: rejectReason
      ? `${stateMsg}: ${rejectReason}`
      : `${stateMsg} — no verified fill on Polymarket US`,
  };
}
