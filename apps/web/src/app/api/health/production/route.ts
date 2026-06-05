import { NextResponse } from "next/server";
import {
  getDashboardMetricsSnapshot,
  type DashboardSnapshotPayload,
} from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await getDashboardMetricsSnapshot<DashboardSnapshotPayload>();
    if (snap?.data?.productionHealth) {
      return NextResponse.json({
        ...snap.data.productionHealth,
        _source: "snapshot",
        _capturedAt: snap.meta.capturedAt,
      });
    }
    return NextResponse.json(
      {
        error: "production health snapshot not ready",
        hint: "Run worker web:snapshot-refresh or wait for next interval",
      },
      { status: 503 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "health check failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
