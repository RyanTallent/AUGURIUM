export function idempotencyKeyForSignal(signalId: string): string {
  return `order:signal:${signalId}`;
}

export function fillIdempotencyKey(orderId: string, seq: number): string {
  return `fill:${orderId}:${seq}`;
}

export function lockKeyForSignal(signalId: string): string {
  return `lock:signal:${signalId}`;
}

export function discordDedupeForExecution(
  mode: string,
  signalId: string,
  action: string,
): string {
  return `execution:${mode}:${action}:${signalId}`;
}

export interface LockStore {
  acquire(lockKey: string, holder: string, ttlMs: number): Promise<boolean>;
  release(lockKey: string, holder: string): Promise<void>;
}

export class MemoryLockStore implements LockStore {
  locks = new Map<string, { holder: string; expiresAt: number }>();

  async acquire(lockKey: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(lockKey);
    if (existing && existing.expiresAt > now && existing.holder !== holder) {
      return false;
    }
    this.locks.set(lockKey, { holder, expiresAt: now + ttlMs });
    return true;
  }

  async release(lockKey: string, holder: string): Promise<void> {
    const existing = this.locks.get(lockKey);
    if (existing?.holder === holder) this.locks.delete(lockKey);
  }
}
