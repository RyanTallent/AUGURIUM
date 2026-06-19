/** @deprecated US compatibility cache removed in US-only architecture. */

export async function scoreTraderUsLiveCompatCached(
  _traderId: string,
  _address: string,
  _opts?: { catalogOnly?: boolean; allowScanFetch?: boolean; force?: boolean },
): Promise<{
  bestConfidence: number;
  hasTradeableUsPosition: boolean;
  openPositions: number;
  usCompatible: number;
}> {
  return { bestConfidence: 1, hasTradeableUsPosition: true, openPositions: 0, usCompatible: 0 };
}

export function getCachedUsCompat(): null {
  return null;
}

export function setCachedUsCompat(): void {
  // no-op
}

export function invalidateUsCompat(): void {
  // no-op
}
