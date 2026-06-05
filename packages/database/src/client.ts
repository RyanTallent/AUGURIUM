import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function appendParam(url: string, key: string, value: string): string {
  if (new RegExp(`[?&]${key}=`).test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

function buildDatasourceUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;

  const service = process.env.AUGURIUM_SERVICE;
  if (service === "web") {
    const limit = process.env.WEB_PRISMA_CONNECTION_LIMIT ?? "5";
    const poolTimeout = process.env.WEB_PRISMA_POOL_TIMEOUT_SEC ?? "30";
    const connectTimeout = process.env.WEB_PRISMA_CONNECT_TIMEOUT_SEC ?? "15";
    let url = base;
    url = appendParam(url, "connection_limit", limit);
    url = appendParam(url, "pool_timeout", poolTimeout);
    url = appendParam(url, "connect_timeout", connectTimeout);
    return url;
  }

  if (service === "worker") {
    const limit = process.env.WORKER_PRISMA_CONNECTION_LIMIT ?? "8";
    const poolTimeout = process.env.WORKER_PRISMA_POOL_TIMEOUT_SEC ?? "30";
    const connectTimeout = process.env.WORKER_PRISMA_CONNECT_TIMEOUT_SEC ?? "15";
    let url = base;
    url = appendParam(url, "connection_limit", limit);
    url = appendParam(url, "pool_timeout", poolTimeout);
    url = appendParam(url, "connect_timeout", connectTimeout);
    return url;
  }

  return base;
}

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: buildDatasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;
