import { NextResponse } from "next/server";
import { getSnapshotAgeSummary, pingDatabase } from "@augurium/database";
import { runWithWebDbGuard, webMemorySnapshot } from "@/lib/web-db-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEEP_TIMEOUT_MS = Number(process.env.WEB_HEALTH_DB_TIMEOUT_MS ?? "20000");

/** Optional diagnostics — not used by Render health checks. */
export async function GET() {
  const started = Date.now();
  const mem = webMemorySnapshot();

  const ping = await runWithWebDbGuard(
    "health-deep-ping",
    () => pingDatabase(),
    { timeoutMs: DEEP_TIMEOUT_MS },
  );

  let snapshotAges = null;
  if (ping.data != null) {
    const snaps = await runWithWebDbGuard(
      "health-deep-snapshots",
      () => getSnapshotAgeSummary(),
      { timeoutMs: Math.max(5000, DEEP_TIMEOUT_MS - (Date.now() - started)) },
    );
    snapshotAges = snaps.data;
  }

  const dbOk = ping.data != null && !ping.error;
  const dbError = ping.error ?? (dbOk ? null : "db ping failed");

  return NextResponse.json({
    ok: dbOk,
    service: "augurium-web",
    probe: "deep",
    db: dbOk ? "up" : "down",
    dbError,
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    auguriumService: process.env.AUGURIUM_SERVICE ?? null,
    latencyMs: Date.now() - started,
    memory: mem,
    snapshots: snapshotAges,
    hints:
      !dbOk && mem.inFlightQueries >= 2
        ? ["Web query slots may be busy — retry in a few seconds"]
        : undefined,
  });
}
