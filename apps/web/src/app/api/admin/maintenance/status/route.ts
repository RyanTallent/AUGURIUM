import { NextResponse } from "next/server";
import { getLastMaintenanceRun } from "@augurium/database";
import {
  getMaintenanceAdminConfig,
  verifyMaintenanceAdminToken,
} from "@/lib/admin-maintenance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getMaintenanceAdminConfig();
  const authorized = verifyMaintenanceAdminToken(request);
  const lastRun = await getLastMaintenanceRun();
  return NextResponse.json({
    tokenConfigured: config.tokenConfigured,
    authorized,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          source: lastRun.source,
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          dryRun: lastRun.dryRun,
          before: lastRun.before,
          after: lastRun.after,
          repairsApplied: lastRun.steps?.filter((s) => s.status === "ok").map((s) => s.name) ?? [],
        }
      : null,
  });
}
