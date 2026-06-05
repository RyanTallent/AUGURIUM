import { NextResponse } from "next/server";
import { prisma } from "@augurium/database";
import { getSnapshotAgeSummary } from "@augurium/database";
import { webMemorySnapshot } from "@/lib/web-db-guard";

export const dynamic = "force-dynamic";

/** Lightweight liveness — no heavy analytics (Render health check). */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "db ping failed";
  }

  let snapshotAges = null;
  try {
    snapshotAges = await getSnapshotAgeSummary();
  } catch {
    snapshotAges = null;
  }

  const mem = webMemorySnapshot();
  const ok = dbOk;
  const status = ok ? 200 : 503;

  return NextResponse.json(
    {
      ok,
      service: "augurium-web",
      db: dbOk ? "up" : "down",
      dbError,
      latencyMs: Date.now() - started,
      memory: mem,
      snapshots: snapshotAges,
      hint: ok
        ? "Use /api/health/production for full ops report (worker snapshots preferred)."
        : "Database unreachable",
    },
    { status },
  );
}
