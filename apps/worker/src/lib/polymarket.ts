const GAMMA_API = process.env.POLYMARKET_GAMMA_BASE ?? "https://gamma-api.polymarket.com";
const DATA_API = process.env.POLYMARKET_DATA_BASE ?? "https://data-api.polymarket.com";

export interface GammaMarket {
  id: string;
  question?: string;
  conditionId: string;
  slug?: string;
  category?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  clobTokenIds?: string;
  umaResolutionStatuses?: string;
  acceptingOrders?: boolean;
  events?: Array<{ id: string; slug?: string }>;
}

export interface GammaMarketRecord extends GammaMarket {
  title?: string;
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  endDate?: string;
  active?: boolean;
  category?: string;
  markets?: GammaMarket[];
}

export interface DataApiTrade {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcome?: string;
  transactionHash: string;
  pseudonym?: string;
  name?: string;
}

export interface DataApiActivity extends DataApiTrade {
  type: string;
  usdcSize?: number;
}

export interface DataApiPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  cashPnl?: number;
  outcome?: string;
  title?: string;
  slug?: string;
  eventSlug?: string;
  eventId?: string;
}

export interface HolderEntry {
  proxyWallet: string;
  amount: number;
  outcomeIndex: number;
  pseudonym?: string;
  name?: string;
}

export interface HoldersResponse {
  token: string;
  holders: HolderEntry[];
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Polymarket HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

export function gammaEventsUrl(limit: number, offset: number, active = true): string {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    active: String(active),
  });
  return `${GAMMA_API}/events?${params}`;
}

export function gammaMarketsUrl(
  limit: number,
  offset: number,
  opts: { active?: boolean; closed?: boolean } = {},
): string {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (opts.active !== undefined) params.set("active", String(opts.active));
  if (opts.closed !== undefined) params.set("closed", String(opts.closed));
  return `${GAMMA_API}/markets?${params}`;
}

export function gammaMarketByConditionUrl(conditionId: string): string {
  const params = new URLSearchParams({
    condition_ids: conditionId,
    limit: "1",
  });
  return `${GAMMA_API}/markets?${params}`;
}

export function gammaMarketBySlugUrl(slug: string): string {
  const params = new URLSearchParams({
    slug,
    limit: "5",
  });
  return `${GAMMA_API}/markets?${params}`;
}

export function dataTradesUrl(limit: number, offset: number): string {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return `${DATA_API}/trades?${params}`;
}

export function dataActivityUrl(
  wallet: string,
  limit: number,
  offset: number,
): string {
  const params = new URLSearchParams({
    user: wallet.toLowerCase(),
    limit: String(limit),
    offset: String(offset),
  });
  return `${DATA_API}/activity?${params}`;
}

export function dataPositionsUrl(wallet: string, limit = 100): string {
  const params = new URLSearchParams({
    user: wallet.toLowerCase(),
    limit: String(limit),
  });
  return `${DATA_API}/positions?${params}`;
}

export function dataHoldersUrl(conditionId: string, limit = 50): string {
  const params = new URLSearchParams({
    market: conditionId,
    limit: String(limit),
  });
  return `${DATA_API}/holders?${params}`;
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function tradeExternalKey(
  transactionHash: string,
  asset: string,
  wallet: string,
): string {
  return `${transactionHash}:${asset}:${normalizeAddress(wallet)}`;
}

export function positionExternalKey(
  wallet: string,
  conditionId: string,
  asset: string,
): string {
  return `${normalizeAddress(wallet)}:${conditionId}:${asset}`;
}

export function parseClobTokenIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseResolutionStatus(raw: string | undefined): {
  resolved: boolean;
  resolutionStatus: string | null;
} {
  if (!raw) return { resolved: false, resolutionStatus: null };
  try {
    const statuses = JSON.parse(raw) as unknown;
    if (Array.isArray(statuses) && statuses.length > 0) {
      return { resolved: true, resolutionStatus: String(statuses[0]) };
    }
  } catch {
    /* ignore */
  }
  return { resolved: false, resolutionStatus: null };
}
