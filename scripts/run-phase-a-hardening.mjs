/**
 * One-shot Phase A hardening cycle (no Redis required).
 * Usage: npx tsx scripts/run-phase-a-hardening.mjs
 */
import { ingestPolymarketMarkets } from "../apps/worker/src/jobs/ingest-markets.ts";
import { ingestGlobalTrades } from "../apps/worker/src/jobs/ingest-trades.ts";
import { linkTradesToMarkets } from "../apps/worker/src/jobs/link-trades.ts";
import { discoverWalletsFromHolders } from "../apps/worker/src/jobs/discover-wallets.ts";
import { syncPositionsFromApi } from "../apps/worker/src/jobs/sync-positions.ts";
import { reconstructPositionsFromTrades } from "../apps/worker/src/jobs/reconstruct-positions.ts";
import { prisma } from "@augurium/database";

const steps = [
  ["markets", ingestPolymarketMarkets],
  ["link-trades", linkTradesToMarkets],
  ["wallet-discover", discoverWalletsFromHolders],
  ["position-sync", syncPositionsFromApi],
  ["position-reconstruct", reconstructPositionsFromTrades],
  ["link-trades-final", linkTradesToMarkets],
];

const only = process.env.PHASE_A_STEP;
const filtered = only ? steps.filter(([name]) => name === only) : steps;

for (const [name, fn] of filtered) {
  console.log(`\n=== ${name} ===`);
  const result = await fn();
  console.log(`${name} done:`, result);
}

await prisma.$disconnect();
