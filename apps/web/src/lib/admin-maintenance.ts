import {
  getLastMaintenanceRun,
  runProductionMaintenance,
  MAINTENANCE_SOURCE_PRODUCTION,
} from "@augurium/database";
import { prisma } from "@augurium/database";

export function verifyMaintenanceAdminToken(request: Request): boolean {
  const expected = (process.env.MAINTENANCE_ADMIN_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-maintenance-admin-token") ?? "";
  return bearer === expected || alt === expected;
}

export async function hasActiveMaintenanceRun(): Promise<boolean> {
  const active = await prisma.ingestionRun.findFirst({
    where: {
      source: { in: [MAINTENANCE_SOURCE_PRODUCTION, "maintenance:daily"] },
      status: "running",
    },
  });
  return Boolean(active);
}

export async function triggerMaintenance(dryRun: boolean) {
  if (await hasActiveMaintenanceRun()) {
    return { ok: false as const, error: "maintenance already running" };
  }
  const result = await runProductionMaintenance({ dryRun });
  return { ok: true as const, result, lastRun: await getLastMaintenanceRun() };
}
