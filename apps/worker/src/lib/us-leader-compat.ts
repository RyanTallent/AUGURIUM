/** @deprecated US compatibility scoring removed in US-only architecture. */

export function usLeaderCompatRequired(): boolean {
  return false;
}

export function maxFullGateLeaders(): number {
  return 0;
}

export async function scoreTraderUsLiveCompat(): Promise<{
  bestConfidence: number;
  hasTradeableUsPosition: boolean;
  openPositions: number;
  usCompatible: number;
  likelyGlobalOnly: number;
}> {
  return {
    bestConfidence: 1,
    hasTradeableUsPosition: true,
    openPositions: 0,
    usCompatible: 0,
    likelyGlobalOnly: 0,
  };
}

export async function scoreTraderUsLiveCompatFast(): Promise<{
  bestConfidence: number;
  hasTradeableUsPosition: boolean;
  openPositions: number;
  usCompatible: number;
}> {
  return { bestConfidence: 1, hasTradeableUsPosition: true, openPositions: 0, usCompatible: 0 };
}

export function isLikelyGlobalOnlyMarketTitle(): boolean {
  return false;
}

export function isLikelyUsOverlapMarketTitle(): boolean {
  return true;
}
