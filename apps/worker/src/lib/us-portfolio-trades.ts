import { getPolymarketUsClient, readConfigSecret } from "@augurium/execution";

export interface UsPortfolioTradeRow {
  tradeId: string;
  marketSlug: string;
  price: number;
  quantity: number;
  tradedAt: Date;
  side: "BUY" | "SELL";
}

function readAmountUsd(raw: { value?: string } | undefined): number {
  const n = Number(raw?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Wallet address for the authenticated Polymarket US API key (activities are account-scoped). */
export function resolveUsTraderWallet(): string {
  const wallet =
    readConfigSecret("POLYMARKET_US_TRADER_WALLET") ??
    readConfigSecret("POLYMARKET_FUNDER_ADDRESS");
  if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) {
    throw new Error(
      "Set POLYMARKET_US_TRADER_WALLET or POLYMARKET_FUNDER_ADDRESS (0x…) for US portfolio trade ingest",
    );
  }
  return wallet.toLowerCase();
}

export async function fetchUsPortfolioTradePage(opts?: {
  limit?: number;
  cursor?: string;
  marketSlug?: string;
}): Promise<{ trades: UsPortfolioTradeRow[]; nextCursor: string | null; eof: boolean }> {
  const client = getPolymarketUsClient();
  const res = await client.portfolio.activities({
    limit: opts?.limit ?? 50,
    cursor: opts?.cursor,
    marketSlug: opts?.marketSlug,
    types: ["ACTIVITY_TYPE_TRADE"],
    sortOrder: "SORT_ORDER_DESCENDING",
  });

  const trades: UsPortfolioTradeRow[] = [];
  for (const activity of res.activities ?? []) {
    const t = activity.trade;
    if (!t?.id || !t.marketSlug) continue;
    const qty = Number(t.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    trades.push({
      tradeId: t.id,
      marketSlug: t.marketSlug,
      price: readAmountUsd(t.price),
      quantity: qty,
      tradedAt: t.updateTime ? new Date(t.updateTime) : new Date(),
      side: t.isAggressor ? "BUY" : "SELL",
    });
  }

  return {
    trades,
    nextCursor: res.nextCursor ?? null,
    eof: res.eof === true || !res.nextCursor,
  };
}
