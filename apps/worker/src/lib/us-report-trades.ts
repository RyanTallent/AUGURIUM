const REPORT_BASE =
  process.env.POLYMARKET_US_REPORT_BASE ?? "https://api.prod.polymarketexchange.com";

export interface UsMarketTradeStats {
  symbol: string;
  totalTradeCount: number;
  clearedVolume: number;
}

/**
 * Public exchange trade stats (aggregated — no wallet addresses).
 * Institutional /v1/report/trades/search requires Auth0 + x-participant-id and only
 * returns the authenticated participant's trades — not usable with retail API keys.
 */
export async function fetchUsMarketTradeStats(symbol: string): Promise<UsMarketTradeStats | null> {
  const end = new Date();
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const res = await fetch(`${REPORT_BASE}/v1/report/trades/stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      symbol,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }),
  });

  if (!res.ok) return null;

  const body = (await res.json()) as {
    stats?: { totalTradeCount?: string; clearedVolume?: string };
  };
  const stats = body.stats;
  if (!stats) return null;

  return {
    symbol,
    totalTradeCount: Number(stats.totalTradeCount ?? 0),
    clearedVolume: Number(stats.clearedVolume ?? 0),
  };
}
