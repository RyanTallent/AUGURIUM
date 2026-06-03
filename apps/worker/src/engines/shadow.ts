import { runShadowPortfolioJob } from "../jobs/run-shadow-portfolio.js";

/** Phase D — shadow portfolio + simulations (no live execution). */
export async function syncShadowPortfolio(): Promise<number> {
  const summary = await runShadowPortfolioJob();
  console.log("[shadow]", summary);
  return summary.created + summary.updated;
}
