import { runShadowPortfolioJob } from "../apps/worker/src/jobs/run-shadow-portfolio.ts";

const summary = await runShadowPortfolioJob();
console.log("[run-shadow-portfolio]", summary);
