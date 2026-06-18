import { NextResponse } from "next/server";
import { seedUsLeaderWatchlistWallet } from "@augurium/copy-trading";
import { getCopyAdminConfig, verifyCopyAdminToken } from "@/lib/admin-maintenance";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCopyAdminToken(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { wallet?: string; notes?: string };
  try {
    body = (await request.json()) as { wallet?: string; notes?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const wallet = body.wallet?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }

  try {
    const result = await seedUsLeaderWatchlistWallet({
      wallet,
      notes: body.notes?.trim() || undefined,
    });

    return NextResponse.json({
      walletAdded: result.wallet,
      watchlistId: result.watchlistId,
      metricsFound: result.metricsFound,
      positionsSynced: result.positionsSynced,
      usMatchConfidence: result.usMatchConfidence,
      leaderGatesPass: result.leaderGatesPass,
      gateReasons: result.gateReasons,
      tokenConfigured: getCopyAdminConfig().tokenConfigured,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "seed failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
