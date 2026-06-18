import { prisma } from "@augurium/database";

const STREAM = "copy:pipeline-rhythm";
const SLOW_MS = Number(process.env.COPY_SLOW_DISCOVERY_MS ?? "2700000");

let lastSlowAtMs = 0;

export type PipelineCycleMode = "fast" | "slow";

export async function resolvePipelineCycleMode(): Promise<PipelineCycleMode> {
  const cursor = await prisma.syncCursor.findUnique({
    where: { stream: STREAM },
    select: { metadata: true },
  });
  const meta = cursor?.metadata as { lastSlowAt?: string } | null;
  const persisted = meta?.lastSlowAt ? new Date(meta.lastSlowAt).getTime() : 0;
  lastSlowAtMs = Math.max(lastSlowAtMs, persisted);

  if (Date.now() - lastSlowAtMs >= SLOW_MS) return "slow";
  return "fast";
}

export async function markSlowDiscoveryCompleted(): Promise<void> {
  lastSlowAtMs = Date.now();
  await prisma.syncCursor.upsert({
    where: { stream: STREAM },
    create: {
      stream: STREAM,
      cursorType: "timestamp",
      cursorValue: String(lastSlowAtMs),
      metadata: { lastSlowAt: new Date(lastSlowAtMs).toISOString() },
    },
    update: {
      cursorValue: String(lastSlowAtMs),
      metadata: { lastSlowAt: new Date(lastSlowAtMs).toISOString() },
    },
  });
}

export function slowDiscoveryIntervalMs(): number {
  return SLOW_MS;
}

export async function loadLastSlowFunnelMeta(): Promise<Record<string, unknown> | null> {
  const cursor = await prisma.syncCursor.findUnique({
    where: { stream: "copy:slow-funnel" },
    select: { metadata: true },
  });
  return (cursor?.metadata as Record<string, unknown> | null) ?? null;
}

export async function saveLastSlowFunnelMeta(meta: Record<string, unknown>): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { stream: "copy:slow-funnel" },
    create: {
      stream: "copy:slow-funnel",
      cursorType: "metadata",
      cursorValue: "0",
      metadata: meta as object,
    },
    update: { metadata: meta as object },
  });
}
