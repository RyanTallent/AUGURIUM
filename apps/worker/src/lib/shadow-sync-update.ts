import type { Prisma } from "@augurium/database";

const PRICE_EPS = 1e-9;

export function sameTimestamp(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

export function basePriceFieldsUnchanged(
  shadow: {
    currentPrice: number;
    priceStatus: string;
    priceSource: string | null;
    lastPriceUpdateAt: Date | null;
  },
  priced: {
    currentPrice: number;
    priceStatus: string;
    priceSource: string | null;
    lastPriceUpdateAt: Date | null;
  },
): boolean {
  return (
    shadow.priceStatus === priced.priceStatus &&
    shadow.priceSource === priced.priceSource &&
    Math.abs(shadow.currentPrice - priced.currentPrice) <= PRICE_EPS &&
    sameTimestamp(shadow.lastPriceUpdateAt, priced.lastPriceUpdateAt)
  );
}

export function openPositionFieldsUnchanged(
  shadow: {
    positionRemaining: number;
    unrealizedPnl: number;
    realizedPnl: number;
    roi: number;
    maxFavorableExcursion: number;
    maxAdverseExcursion: number;
    partialExitDone: boolean;
    runnerActive: boolean;
    latestReasoning: string;
    status: string;
  },
  next: {
    positionRemaining: number;
    unrealizedPnl: number;
    realizedPnl: number;
    roi: number;
    maxFavorableExcursion: number;
    maxAdverseExcursion: number;
    partialExitDone: boolean;
    runnerActive: boolean;
    latestReasoning: string;
    status: string;
  },
): boolean {
  return (
    shadow.status === next.status &&
    shadow.positionRemaining === next.positionRemaining &&
    Math.abs(shadow.unrealizedPnl - next.unrealizedPnl) <= PRICE_EPS &&
    Math.abs(shadow.realizedPnl - next.realizedPnl) <= PRICE_EPS &&
    Math.abs(shadow.roi - next.roi) <= PRICE_EPS &&
    Math.abs(shadow.maxFavorableExcursion - next.maxFavorableExcursion) <= PRICE_EPS &&
    Math.abs(shadow.maxAdverseExcursion - next.maxAdverseExcursion) <= PRICE_EPS &&
    shadow.partialExitDone === next.partialExitDone &&
    shadow.runnerActive === next.runnerActive &&
    shadow.latestReasoning === next.latestReasoning
  );
}

export type ShadowRowUpdate = {
  id: string;
  data: Prisma.ShadowTradeUpdateInput;
};
