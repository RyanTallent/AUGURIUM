import { runExecutionEngineJob } from "../jobs/run-execution-engine.js";

/** Phase G — execution engine (disabled by default; paper/live gated). */
export async function runExecutionEngine(): Promise<number> {
  const summary = await runExecutionEngineJob();
  console.log("[execution]", summary);
  return summary.placed + summary.blocked;
}
