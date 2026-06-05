import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Render liveness probe — must respond immediately with 200.
 * Do not await Prisma here (first connect can hang and cause deploy EOF).
 * Use GET /api/health/deep for DB + snapshot diagnostics.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "augurium-web",
      probe: "liveness",
      ts: new Date().toISOString(),
    },
    { status: 200 },
  );
}
