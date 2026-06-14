const BASE_URL =
  process.env.POLYMARKET_SCAN_API_BASE ??
  "https://gzydspfquuaudqeztorw.supabase.co/functions/v1/agent-api";

const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

export interface PolymarketScanResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export async function polymarketScanFetch<T>(
  action: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<PolymarketScanResponse<T>> {
  await throttle();
  const qs = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${BASE_URL}?${qs.toString()}`;
  const timeoutMs = Number(process.env.POLYMARKET_SCAN_FETCH_TIMEOUT_MS ?? "12000");
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const json = (await res.json()) as PolymarketScanResponse<T>;
  return json;
}

export interface ScanWhaleRow {
  wallet: string;
  market_title?: string;
  market_slug?: string;
  market_category?: string;
  amount_usd?: number;
  side?: string;
  outcome?: string;
}

export interface ScanWalletTrade {
  market: string;
  market_question: string;
  event_slug?: string;
  outcome: string;
  side: string;
  price: number;
  size: number;
  trade_timestamp: string;
  transaction_hash: string;
}

export interface ScanWalletPnlSummary {
  total_pnl?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  roi?: number;
  roi_percent?: number;
  win_rate?: number;
  trade_count?: number;
}

export interface ScanTraderBadge {
  badge_type: string;
  badge_reason?: string;
  market_title?: string;
  confidence?: number;
}
