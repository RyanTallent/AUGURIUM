import { NextResponse } from "next/server";
import {
  getLastMaintenanceRun,
  getLastWorkerMemoryFromRuns,
  getProductionHealthReport,
} from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [health, lastMaintenance, workerMem] = await Promise.all([
      getProductionHealthReport(),
      getLastMaintenanceRun(),
      getLastWorkerMemoryFromRuns(),
    ]);

    return NextResponse.json({
      workerMemory: workerMem,
      workerMemoryHigh: health.workerMemoryHigh,
      ingestionFailedRuns24h: health.ingestionFailedRuns24h,
      lastMaintenance: lastMaintenance
        ? {
            id: lastMaintenance.id,
            source: lastMaintenance.source,
            status: lastMaintenance.status,
            startedAt: lastMaintenance.startedAt,
            finishedAt: lastMaintenance.finishedAt,
            dryRun: lastMaintenance.dryRun,
          }
        : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker health failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
