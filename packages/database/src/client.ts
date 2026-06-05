import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function buildDatasourceUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;
  const isWeb = process.env.AUGURIUM_SERVICE === "web";
  if (!isWeb) return base;
  const limit = process.env.WEB_PRISMA_CONNECTION_LIMIT ?? "3";
  const poolTimeout = process.env.WEB_PRISMA_POOL_TIMEOUT_SEC ?? "20";
  const connectTimeout = process.env.WEB_PRISMA_CONNECT_TIMEOUT_SEC ?? "10";
  try {
    const url = new URL(base);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", limit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", poolTimeout);
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", connectTimeout);
    }
    return url.toString();
  } catch {
    return base;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: buildDatasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
