import type { ProviderBalance, ProviderOrder, ProviderPosition } from "./types.js";

export interface PaperOrderRecord {
  id: string;
  idempotencyKey: string;
  signalId: string;
  marketId: string;
  side: string;
  status: string;
  requestedSizeUsd: number;
  requestedPrice: number;
  fillPrice?: number;
  filledSizeUsd: number;
  providerOrderId: string;
}

export interface PaperPositionRecord {
  id: string;
  signalId: string;
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
}

export interface PaperStore {
  getBalance(): Promise<ProviderBalance>;
  getOpenPositions(): Promise<PaperPositionRecord[]>;
  getOpenOrders(): Promise<PaperOrderRecord[]>;
  findOrderByIdempotency(key: string): Promise<PaperOrderRecord | null>;
  findOpenPosition(marketId: string, side: string): Promise<PaperPositionRecord | null>;
  findOppositePosition(marketId: string, side: string): Promise<PaperPositionRecord | null>;
  createOrder(record: PaperOrderRecord): Promise<void>;
  updateOrder(id: string, patch: Partial<PaperOrderRecord>): Promise<void>;
  createPosition(record: PaperPositionRecord): Promise<void>;
  updatePosition(id: string, patch: Partial<PaperPositionRecord>): Promise<void>;
  getPosition(id: string): Promise<PaperPositionRecord | null>;
  resolveFillPrice(
    marketId: string,
    side: string,
    requestedPrice: number,
  ): Promise<number>;
}

export function oppositeSide(side: string): string {
  const s = side.toUpperCase();
  if (s === "YES") return "NO";
  if (s === "NO") return "YES";
  return s === "BUY" ? "SELL" : "BUY";
}
