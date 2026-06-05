import { NextResponse } from "next/server";
import {
  getLastMaintenanceRun,
  getLastWorkerMemoryFromRuns,
  getWebDiagnosticsSnapshot,
} from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [diag, lastMaintenance, workerMem] = await Promise.all([
      getWebDiagnosticsSnapshot(),
      getLastMaintenanceRun(),
      getLastWorkerMemoryFromRuns(),
    ]);

    return NextResponse.json({
      workerMemory: workerMem,
      workerMemoryHigh: workerMem?.highWatermark ?? false,
      snapshotRefresh: diag?.data ?? null,
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
