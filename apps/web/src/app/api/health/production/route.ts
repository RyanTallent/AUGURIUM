import { NextResponse } from "next/server";
import { getProductionHealthReport } from "@augurium/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = await getProductionHealthReport();
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "health check failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
