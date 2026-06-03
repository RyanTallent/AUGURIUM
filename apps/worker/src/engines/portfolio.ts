import { runPortfolioEngineJob } from "../jobs/run-portfolio-engine.js";

/** Phase F — simulated portfolio, risk, allocation (no live execution). */
export async function runPortfolioEngine(): Promise<number> {
  const summary = await runPortfolioEngineJob();
  console.log("[portfolio]", summary);
  return summary.decisions;
}
