import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
} from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { getExecutionConfig } from "./config.js";

const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com";

let cachedClient: ClobClient | null = null;

function normalizePrivateKey(raw: string): `0x${string}` {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
}

function signatureType(): SignatureTypeV2 {
  const raw = Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "1");
  if (raw === 0) return SignatureTypeV2.EOA;
  if (raw === 2) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (raw === 3) return SignatureTypeV2.POLY_1271;
  return SignatureTypeV2.POLY_PROXY;
}

function apiCredsFromEnv(): ApiKeyCreds | undefined {
  const key = process.env.POLYMARKET_API_KEY?.trim();
  const secret = process.env.POLYMARKET_API_SECRET?.trim();
  const passphrase = process.env.POLYMARKET_API_PASSPHRASE?.trim();
  if (!key || !secret || !passphrase) return undefined;
  return { key, secret, passphrase };
}

export async function getPolymarketClobClient(): Promise<ClobClient> {
  if (cachedClient) return cachedClient;

  const cfg = getExecutionConfig();
  if (!cfg.hasPrivateKey) {
    throw new Error("POLYMARKET_PRIVATE_KEY not configured");
  }

  const account = privateKeyToAccount(normalizePrivateKey(process.env.POLYMARKET_PRIVATE_KEY!));
  const signer = createWalletClient({
    account,
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com"),
  });

  let creds = apiCredsFromEnv();
  if (!creds) {
    const bootstrap = new ClobClient({ host: CLOB_HOST, chain: 137, signer });
    creds = await bootstrap.createOrDeriveApiKey();
  }

  cachedClient = new ClobClient({
    host: CLOB_HOST,
    chain: 137,
    signer,
    creds,
    signatureType: signatureType(),
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS?.trim(),
    useServerTime: true,
  });

  return cachedClient;
}

export function mapOutcomeSideToClob(side: string): Side {
  const s = side.toUpperCase();
  if (s === "SELL" || s === "SHORT") return Side.SELL;
  return Side.BUY;
}

export async function validateClobConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await getPolymarketClobClient();
    await client.getOk();
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const available = Number(bal.balance ?? 0) / 1_000_000;
    return { ok: true, message: `CLOB ok · USDC balance ~${available.toFixed(2)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "CLOB validation failed";
    return { ok: false, message };
  }
}

export { Side, OrderType, ClobClient };
