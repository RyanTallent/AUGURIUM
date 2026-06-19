const REPORT_BASE =
  process.env.POLYMARKET_US_REPORT_BASE ?? "https://api.prod.polymarketexchange.com";

export interface UsReportTradeRow {
  id: string;
  symbol: string;
  aggressorAccount: string | null;
  passiveAccount: string | null;
  aggressorParticipant: string | null;
  passiveParticipant: string | null;
  price: number;
  quantity: number;
  transactTime: string;
}

type RawTrade = {
  id?: string;
  aggressor?: { order?: { symbol?: string; account?: string; participant?: string }; lastPx?: string; lastShares?: string; transactTime?: string };
  passive?: { order?: { symbol?: string; account?: string; participant?: string }; lastPx?: string; lastShares?: string; transactTime?: string };
};

function readPx(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 1_000_000 : n;
}

function readQty(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeWallet(account: string | null | undefined, participant: string | null | undefined): string | null {
  const candidate = (account ?? participant ?? "").trim().toLowerCase();
  if (!candidate) return null;
  if (/^0x[a-f0-9]{40}$/.test(candidate)) return candidate;
  if (candidate.length >= 8) return candidate;
  return null;
}

export async function searchUsExchangeTrades(input: {
  symbol: string;
  pageSize?: number;
  pageToken?: string;
  startTime?: string;
}): Promise<{ trades: UsReportTradeRow[]; nextPageToken: string | null }> {
  const res = await fetch(`${REPORT_BASE}/v1/report/trades/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      symbol: input.symbol,
      pageSize: input.pageSize ?? 50,
      pageToken: input.pageToken,
      startTime: input.startTime,
      states: ["TRADE_STATE_CLEARED"],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`US report trades ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as { trade?: RawTrade[]; nextPageToken?: string };
  const trades: UsReportTradeRow[] = [];

  for (const row of body.trade ?? []) {
    const symbol = row.aggressor?.order?.symbol ?? row.passive?.order?.symbol ?? input.symbol;
    const px = readPx(row.aggressor?.lastPx ?? row.passive?.lastPx);
    const qty = readQty(row.aggressor?.lastShares ?? row.passive?.lastShares);
    trades.push({
      id: row.id ?? `${symbol}:${row.aggressor?.transactTime ?? Date.now()}`,
      symbol,
      aggressorAccount: normalizeWallet(row.aggressor?.order?.account, row.aggressor?.order?.participant),
      passiveAccount: normalizeWallet(row.passive?.order?.account, row.passive?.order?.participant),
      aggressorParticipant: row.aggressor?.order?.participant ?? null,
      passiveParticipant: row.passive?.order?.participant ?? null,
      price: px,
      quantity: qty,
      transactTime: row.aggressor?.transactTime ?? row.passive?.transactTime ?? new Date().toISOString(),
    });
  }

  return { trades, nextPageToken: body.nextPageToken ?? null };
}
