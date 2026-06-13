import { PolymarketUS } from "polymarket-us";
import { readConfigSecret } from "./render-secret.js";

let cachedClient: PolymarketUS | null = null;

export function getPolymarketUsClient(): PolymarketUS {
  if (cachedClient) return cachedClient;

  const keyId = readConfigSecret("POLYMARKET_US_KEY_ID");
  const secretKey = readConfigSecret("POLYMARKET_US_SECRET_KEY");
  if (!keyId || !secretKey) {
    throw new Error("POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY not configured");
  }

  cachedClient = new PolymarketUS({
    keyId,
    secretKey,
    apiBaseUrl: process.env.POLYMARKET_US_API_BASE ?? "https://api.polymarket.us",
    gatewayBaseUrl: process.env.POLYMARKET_US_GATEWAY_BASE ?? "https://gateway.polymarket.us",
  });

  return cachedClient;
}

export function isPolymarketUsReady(): boolean {
  const v = process.env.POLYMARKET_US_READY;
  return v === "true" || v === "1" || v === "yes";
}

export async function validatePolymarketUsConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const client = getPolymarketUsClient();
    const res = await client.account.balances();
    const balance = res.balances[0];
    const buyingPower = balance?.buyingPower ?? balance?.currentBalance ?? 0;
    const cash = balance?.currentBalance ?? buyingPower;
    return {
      ok: true,
      message: `Polymarket US ok · cash ~$${Number(cash).toFixed(2)} · buying power ~$${Number(buyingPower).toFixed(2)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Polymarket US validation failed";
    return { ok: false, message };
  }
}
