import { NextResponse } from "next/server";
import { getSnapshotAgeSummary } from "@augurium/database";
import { webMemorySnapshot } from "@/lib/web-db-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = Number(process.env.WEB_HEALTH_DB_TIMEOUT_MS ?? "5000");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Optional diagnostics — not used by Render health checks. */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | null = null;

  try {
    const { prisma } = await import("@augurium/database");
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "db ping failed";
  }

  let snapshotAges = null;
  try {
    snapshotAges = await withTimeout(getSnapshotAgeSummary(), DB_TIMEOUT_MS);
  } catch {
    snapshotAges = null;
  }

  return NextResponse.json({
    ok: dbOk,
    service: "augurium-web",
    probe: "deep",
    db: dbOk ? "up" : "down",
    dbError,
    latencyMs: Date.now() - started,
    memory: webMemorySnapshot(),
    snapshots: snapshotAges,
  });
}
