import { prisma } from "@augurium/database";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";
import {
  polymarketScanFetch,
  type ScanTraderBadge,
  type ScanWalletPnlSummary,
  type ScanWhaleRow,
} from "../lib/polymarket-scan.js";
import { scoreTraderUsLiveCompat, usLeaderCompatRequired } from "../lib/us-leader-compat.js";

const STREAM_LEADERBOARD = "polymarket-scan:leaderboard";
const WHALE_LIMIT = Number(process.env.POLYMARKET_SCAN_WHALE_LIMIT ?? "50");
const WALLET_BATCH = Number(process.env.POLYMARKET_SCAN_WALLET_BATCH ?? "10");

function badgeScore(badges: ScanTraderBadge[]): number {
  if (!badges.length) return 0;
  const whale = badges.filter((b) => b.badge_type.includes("whale")).length;
  const insider = badges.filter((b) => b.badge_type.includes("insider")).length;
  return whale * 15 + insider * 10 + badges.length;
}

function pnlToRanking(summary: ScanWalletPnlSummary | null | undefined): number {
  if (!summary) return 0;
  const roi = Number(summary.roi ?? summary.roi_percent ?? 0);
  const pnl = Number(summary.total_pnl ?? summary.realized_pnl ?? 0);
  const winRate = Number(summary.win_rate ?? 0);
  return Math.max(0, roi * 100 + winRate * 20 + Math.log10(Math.max(1, Math.abs(pnl))) * 5);
}

async function collectLeaderWallets(): Promise<string[]> {
  const wallets = new Set<string>();

  const watchlist = await prisma.usLeaderWatchlist.findMany({
    where: { enabled: true },
    select: { wallet: true },
  });
  for (const w of watchlist) wallets.add(w.wallet.toLowerCase());

  const legacy = await polymarketScanFetch<unknown[]>("leaderboard");
  if (legacy.ok && Array.isArray(legacy.data)) {
    for (const row of legacy.data as Array<{ wallet?: string }>) {
      if (row.wallet) wallets.add(row.wallet.toLowerCase());
    }
  }

  const whales = await polymarketScanFetch<ScanWhaleRow[]>("whales", { limit: WHALE_LIMIT });
  await storeRawPayload("polymarket-scan", `whales?limit=${WHALE_LIMIT}`, whales);
  if (whales.ok && whales.data) {
    for (const row of whales.data) {
      if (row.wallet) wallets.add(row.wallet.toLowerCase());
    }
  }

  return [...wallets];
}

async function upsertTraderFromScan(wallet: string): Promise<void> {
  const traderRes = await polymarketScanFetch<{ profile?: unknown; badges?: ScanTraderBadge[] }>(
    "trader",
    { wallet },
  );
  await storeRawPayload("polymarket-scan", `trader?wallet=${wallet}`, traderRes);

  const pnlRes = await polymarketScanFetch<{
    summary?: ScanWalletPnlSummary | null;
  }>("wallet_pnl", { wallet });
  await storeRawPayload("polymarket-scan", `wallet_pnl?wallet=${wallet}`, pnlRes);

  const badges = traderRes.data?.badges ?? [];
  const rankingScore = Math.max(pnlToRanking(pnlRes.data?.summary), badgeScore(badges));
  const roi = Number(pnlRes.data?.summary?.roi ?? 0);
  const winRate = Number(pnlRes.data?.summary?.win_rate ?? 0);
  const trades = Number(pnlRes.data?.summary?.trade_count ?? 0);

  const traderId = await upsertTraderFromWallet(wallet, "polymarket-scan");
  await prisma.trader.update({
    where: { id: traderId },
    data: {
      rankingScore,
      score: rankingScore,
      roi,
      winRate,
      trades: trades > 0 ? trades : undefined,
      lastScoredAt: new Date(),
      discoveredVia: "polymarket-scan",
    },
  });

  const metricsPass =
    trades >= 15 &&
    rankingScore >= Number(process.env.COPY_MIN_SCORE ?? "72") &&
    roi > 0 &&
    winRate >= 0.5;

  let copyEnabled = metricsPass;
  let disabledReason = metricsPass ? null : "PolymarketScan metrics below COPY threshold";
  const strengths: string[] = copyEnabled ? ["polymarketscan leader"] : [];
  const weaknesses: string[] = copyEnabled ? [] : ["scan metrics below threshold"];

  if (usLeaderCompatRequired()) {
    const usCompat = await scoreTraderUsLiveCompat(traderId, wallet);
    if (usCompat.openPositions > 0 && !usCompat.hasTradeableUsPosition) {
      copyEnabled = false;
      disabledReason = `no US-compatible open positions (${usCompat.openPositions} global-only)`;
      weaknesses.push("open positions not tradable on Polymarket US");
    } else if (usCompat.hasTradeableUsPosition) {
      strengths.push(`US-compat positions: ${usCompat.usCompatible}`);
      if (!metricsPass && usCompat.usCompatible > 0 && trades >= 10 && roi > 0) {
        copyEnabled = true;
        disabledReason = null;
        strengths.push("US-compat leader override");
      }
    }
  }

  await prisma.copyTraderControl.upsert({
    where: { traderId },
    create: {
      traderId,
      copyDecision: copyEnabled ? "COPY" : "WATCH",
      copyScore: rankingScore,
      riskScore: Math.max(0, 100 - rankingScore),
      expectedValue: roi,
      enabled: copyEnabled,
      disabledReason,
      strengths,
      weaknesses,
    },
    update: {
      copyDecision: copyEnabled ? "COPY" : "WATCH",
      copyScore: rankingScore,
      riskScore: Math.max(0, 100 - rankingScore),
      expectedValue: roi,
      enabled: copyEnabled,
      disabledReason,
      strengths,
      weaknesses,
      evaluatedAt: new Date(),
    },
  });
}

/** PolymarketScan leaderboard/whales → Trader rows + scores (cached in DB). */
export async function ingestPolymarketScanLeaders(): Promise<number> {
  await getOrCreateCursor(STREAM_LEADERBOARD, "batch");
  await markCursorRunning(STREAM_LEADERBOARD);

  const wallets = await collectLeaderWallets();
  const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { stream: STREAM_LEADERBOARD } });
  const offset = Number.parseInt(cursor.cursorValue, 10) || 0;
  const batch = wallets.slice(offset, offset + WALLET_BATCH);

  if (batch.length === 0) {
    await advanceCursor(STREAM_LEADERBOARD, "0", { resetReason: "end-of-wallet-list" });
    return 0;
  }

  for (const wallet of batch) {
    await upsertTraderFromScan(wallet);
  }

  const nextOffset = offset + batch.length >= wallets.length ? 0 : offset + batch.length;
  await advanceCursor(STREAM_LEADERBOARD, String(nextOffset), {
    walletTotal: wallets.length,
    processed: batch.length,
  });

  console.log(
    `[polymarket-scan] leaders ingested batch=${batch.length} offset=${offset} totalWallets=${wallets.length}`,
  );
  return batch.length;
}
