import { prisma } from "@augurium/database";
import { syncPositionsForTrader } from "./sync-positions.js";

const COPY_BATCH = Number(process.env.POSITION_SYNC_COPY_BATCH ?? "15");

/** Sync open positions for COPY-enabled traders before the general rotation. */
export async function syncPositionsForCopyTargetsFirst(): Promise<number> {
  const controls = await prisma.copyTraderControl.findMany({
    where: { enabled: true },
    orderBy: { evaluatedAt: "desc" },
    take: COPY_BATCH,
    include: { trader: true },
  });

  let synced = 0;
  for (const c of controls) {
    synced += await syncPositionsForTrader(c.trader);
  }
  if (controls.length > 0) {
    console.log(`[position-sync:copy] ${synced} positions for ${controls.length} COPY trader(s)`);
  }
  return synced;
}
