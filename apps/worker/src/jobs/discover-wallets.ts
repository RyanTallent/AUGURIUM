import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";
import {
  dataHoldersUrl,
  fetchJson,
  normalizeAddress,
  type HoldersResponse,
} from "../lib/polymarket.js";
import {
  advanceCursor,
  getOrCreateCursor,
  markCursorRunning,
  storeRawPayload,
  upsertTraderFromWallet,
} from "../lib/ingestion-store.js";

const MARKETS_PER_RUN = Number(process.env.WALLET_DISCOVER_MARKETS_PER_RUN ?? "15");
const HOLDERS_LIMIT = Number(process.env.WALLET_DISCOVER_HOLDERS_LIMIT ?? "30");
const HOLDER_SCAN_STREAM = "polymarket:holders:scan-offset";

export async function discoverWalletsFromHolders(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket-wallet-discover", status: "running" },
  });

  let discovered = 0;
  let scanned = 0;
  let skipped = 0;
  let holdersFound = 0;
  const skipReasons: Record<string, number> = {};

  try {
    await getOrCreateCursor(HOLDER_SCAN_STREAM, "offset");
    await markCursorRunning(HOLDER_SCAN_STREAM);

    const cursor = await prisma.syncCursor.findUniqueOrThrow({
      where: { stream: HOLDER_SCAN_STREAM },
    });
    const scanOffset = Number.parseInt(cursor.cursorValue, 10) || 0;

    const markets = await prisma.market.findMany({
      where: { conditionId: { not: null } },
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
      skip: scanOffset,
      take: MARKETS_PER_RUN,
    });

    const totalEligible = await prisma.market.count({
      where: { conditionId: { not: null } },
    });

    for (const market of markets) {
      if (!market.conditionId) {
        skipped++;
        skipReasons["missing-conditionId"] =
          (skipReasons["missing-conditionId"] ?? 0) + 1;
        continue;
      }

      scanned++;

      try {
        const url = dataHoldersUrl(market.conditionId, HOLDERS_LIMIT);
        const groups = await fetchJson<HoldersResponse[]>(url);
        await storeRawPayload("polymarket-data-api", url, groups);

        if (!groups.length) {
          skipReasons["empty-holders-response"] =
            (skipReasons["empty-holders-response"] ?? 0) + 1;
          continue;
        }

        for (const group of groups) {
          for (const holder of group.holders) {
            holdersFound++;
            const address = normalizeAddress(holder.proxyWallet);
            const before = await prisma.trader.findUnique({
              where: { address },
              select: { id: true },
            });

            await upsertTraderFromWallet(address, "market-holders", {
              pseudonym: holder.pseudonym,
              label: holder.name,
            });

            if (!before) discovered++;
          }
        }
      } catch (err) {
        skipped++;
        const reason =
          err instanceof Error ? err.message.slice(0, 80) : "holders-api-error";
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
        console.warn(
          `[discover-wallets] skip ${market.conditionId}: ${reason}`,
        );
      }
    }

    const nextOffset =
      scanOffset + MARKETS_PER_RUN >= totalEligible
        ? 0
        : scanOffset + MARKETS_PER_RUN;

    await advanceCursor(HOLDER_SCAN_STREAM, String(nextOffset), {
      scanned,
      skipped,
      totalEligible,
    });

    const metadata: Prisma.InputJsonValue = {
      marketsScanned: scanned,
      marketsSkipped: skipped,
      skipReasons,
      holdersFound,
      walletsCreated: discovered,
      scanOffset,
      nextOffset,
      totalEligible,
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: discovered,
        metadata,
        finishedAt: new Date(),
      },
    });

    console.log(
      `[discover-wallets] scanned=${scanned} skipped=${skipped} holders=${holdersFound} newWallets=${discovered} (eligible=${totalEligible}, offset=${scanOffset})`,
    );
    if (skipped > 0) console.log(`[discover-wallets] skip reasons`, skipReasons);

    return discovered;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
