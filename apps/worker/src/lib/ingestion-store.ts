import { prisma } from "@augurium/database";
import type { Prisma } from "@augurium/database";

function shouldStoreRawPayload(): boolean {
  const raw = process.env.INGEST_STORE_RAW_PAYLOAD;
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export async function storeRawPayload(
  source: string,
  endpoint: string,
  payload: unknown,
): Promise<string> {
  if (!shouldStoreRawPayload()) return "skipped";
  const row = await prisma.rawApiPayload.create({
    data: {
      source,
      endpoint,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

export async function getOrCreateCursor(stream: string, cursorType: string) {
  return prisma.syncCursor.upsert({
    where: { stream },
    create: { stream, cursorType, cursorValue: "0", status: "idle" },
    update: {},
  });
}

export async function markCursorRunning(stream: string): Promise<void> {
  await prisma.syncCursor.update({
    where: { stream },
    data: { status: "running", lastRunAt: new Date(), error: null },
  });
}

export async function advanceCursor(
  stream: string,
  cursorValue: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.syncCursor.update({
    where: { stream },
    data: {
      cursorValue,
      status: "idle",
      lastSuccessAt: new Date(),
      metadata: metadata ?? undefined,
      error: null,
    },
  });
}

export async function failCursor(stream: string, error: string): Promise<void> {
  await prisma.syncCursor.update({
    where: { stream },
    data: { status: "idle", error },
  });
}

export async function resolveMarketId(conditionId: string): Promise<string | null> {
  const market = await prisma.market.findFirst({
    where: { conditionId },
    select: { id: true },
  });
  return market?.id ?? null;
}

export async function upsertTraderFromWallet(
  address: string,
  discoveredVia: string,
  meta?: { pseudonym?: string; label?: string },
): Promise<string> {
  const normalized = address.toLowerCase();
  const trader = await prisma.trader.upsert({
    where: { address: normalized },
    create: {
      address: normalized,
      discoveredVia,
      pseudonym: meta?.pseudonym,
      label: meta?.label,
      firstSeenAt: new Date(),
      lastActivityAt: new Date(),
    },
    update: {
      lastActivityAt: new Date(),
      ...(meta?.pseudonym ? { pseudonym: meta.pseudonym } : {}),
      ...(meta?.label ? { label: meta.label } : {}),
    },
  });
  return trader.id;
}
