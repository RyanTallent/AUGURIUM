import { NextResponse } from "next/server";
import { triggerMaintenance, verifyMaintenanceAdminToken } from "@/lib/admin-maintenance";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyMaintenanceAdminToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await triggerMaintenance(false);
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json({
    dryRun: false,
    runId: result.result.runId,
    status: result.result.status,
    reportPath: result.result.reportWritten,
    tokenConfigured: Boolean(process.env.MAINTENANCE_ADMIN_TOKEN?.trim()),
    before: result.result.before,
    after: result.result.after,
    repairsApplied: result.result.steps
      .filter((s) => s.status === "ok")
      .map((s) => ({ name: s.name, detail: s.detail })),
  });
}
