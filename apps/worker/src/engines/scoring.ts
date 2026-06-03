import { runScoreTradersJob } from "../jobs/score-traders.js";

/** Phase B — real trader metrics (no signals, no execution). */
export async function scoreTraders(): Promise<number> {
  const summary = await runScoreTradersJob();
  console.log(
    `[scoring] scored=${summary.scored} skipped=${summary.skipped}`,
    summary.skipReasons,
  );
  return summary.scored;
}
