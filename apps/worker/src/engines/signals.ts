import { runGenerateSignalsJob } from "../jobs/generate-signals.js";

/** Phase C — real consensus signals (advisory only, no execution). */
export async function generateSignals(): Promise<number> {
  const summary = await runGenerateSignalsJob();
  console.log(
    `[signals] generated=${summary.generated} expired=${summary.expired}`,
    summary.byType,
  );
  return summary.generated;
}
