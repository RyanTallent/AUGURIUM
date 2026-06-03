/**
 * Generate Phase C market signals from scored trader activity.
 * Usage: npx tsx scripts/run-generate-signals.mjs
 */
import { runGenerateSignalsJob } from "../apps/worker/src/jobs/generate-signals.ts";

const summary = await runGenerateSignalsJob();
console.log("[run-generate-signals]", summary);
