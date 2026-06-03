/**
 * Score all traders with trades (loops batches until done).
 * Usage: npx tsx scripts/run-score-traders.mjs
 */
import { PrismaClient } from "@prisma/client";
import { runScoreTradersJob } from "../apps/worker/src/jobs/score-traders.ts";

const prisma = new PrismaClient();

/** Clear lastScoredAt for wallets that were skipped without a real snapshot. */
const reset = await prisma.trader.updateMany({
  where: {
    lastScoredAt: { not: null },
    NOT: { metricsSnapshots: { some: { skipReason: null } } },
  },
  data: { lastScoredAt: null },
});
console.log(`[run-score-traders] reset ${reset.count} stale lastScoredAt markers`);

let totalScored = 0;
let rounds = 0;
const maxRounds = 200;

while (rounds < maxRounds) {
  const summary = await runScoreTradersJob();
  totalScored += summary.scored;
  rounds++;
  console.log(`[run-score-traders] round ${rounds}`, summary);
  if (summary.scored === 0) break;
}

console.log(`[run-score-traders] done totalScored=${totalScored} rounds=${rounds}`);
await prisma.$disconnect();
