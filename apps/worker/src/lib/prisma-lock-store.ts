import { prisma } from "@augurium/database";
import type { LockStore } from "@augurium/execution";

export class PrismaLockStore implements LockStore {
  async acquire(lockKey: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const existing = await prisma.executionLock.findUnique({ where: { lockKey } });
    if (existing && existing.expiresAt > now && existing.holder !== holder) {
      return false;
    }
    await prisma.executionLock.upsert({
      where: { lockKey },
      create: { lockKey, holder, expiresAt },
      update: { holder, expiresAt },
    });
    return true;
  }

  async release(lockKey: string, holder: string): Promise<void> {
    const existing = await prisma.executionLock.findUnique({ where: { lockKey } });
    if (existing?.holder === holder) {
      await prisma.executionLock.delete({ where: { lockKey } });
    }
  }
}
