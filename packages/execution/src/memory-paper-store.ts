import type { ProviderBalance } from "./types.js";
import { oppositeSide, type PaperOrderRecord, type PaperPositionRecord, type PaperStore } from "./paper-store.js";

export class MemoryPaperStore implements PaperStore {
  balance: ProviderBalance = { availableUsd: 70, totalUsd: 70 };
  orders = new Map<string, PaperOrderRecord>();
  positions = new Map<string, PaperPositionRecord>();
  prices = new Map<string, number>();

  setPrice(marketId: string, price: number): void {
    this.prices.set(marketId, price);
  }

  async getBalance(): Promise<ProviderBalance> {
    return this.balance;
  }

  async getOpenPositions(): Promise<PaperPositionRecord[]> {
    return [...this.positions.values()].filter((p) => p.status === "OPEN");
  }

  async getOpenOrders(): Promise<PaperOrderRecord[]> {
    return [...this.orders.values()].filter(
      (o) => o.status === "SUBMITTED" || o.status === "PARTIAL",
    );
  }

  async findOrderByIdempotency(key: string): Promise<PaperOrderRecord | null> {
    for (const o of this.orders.values()) {
      if (o.idempotencyKey === key) return o;
    }
    return null;
  }

  async findOpenPosition(
    marketId: string,
    side: string,
  ): Promise<PaperPositionRecord | null> {
    for (const p of this.positions.values()) {
      if (p.marketId === marketId && p.side === side && p.status === "OPEN") return p;
    }
    return null;
  }

  async findOppositePosition(
    marketId: string,
    side: string,
  ): Promise<PaperPositionRecord | null> {
    const opp = oppositeSide(side);
    return this.findOpenPosition(marketId, opp);
  }

  async createOrder(record: PaperOrderRecord): Promise<void> {
    this.orders.set(record.id, record);
  }

  async updateOrder(id: string, patch: Partial<PaperOrderRecord>): Promise<void> {
    const o = this.orders.get(id);
    if (o) this.orders.set(id, { ...o, ...patch });
  }

  async createPosition(record: PaperPositionRecord): Promise<void> {
    this.positions.set(record.id, record);
  }

  async updatePosition(id: string, patch: Partial<PaperPositionRecord>): Promise<void> {
    const p = this.positions.get(id);
    if (p) this.positions.set(id, { ...p, ...patch });
  }

  async getPosition(id: string): Promise<PaperPositionRecord | null> {
    return this.positions.get(id) ?? null;
  }

  async resolveFillPrice(
    marketId: string,
    _side: string,
    requestedPrice: number,
  ): Promise<number> {
    return this.prices.get(marketId) ?? requestedPrice;
  }
}
