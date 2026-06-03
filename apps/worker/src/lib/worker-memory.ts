import { QUEUES } from "@augurium/shared";

const HEAP_HIGH_MB = Number(process.env.WORKER_HEAP_HIGH_MB ?? "1400");

export interface WorkerMemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  highWatermark: boolean;
  capturedAt: string;
}

let lastSnapshot: WorkerMemorySnapshot | null = null;

export function captureWorkerMemory(): WorkerMemorySnapshot {
  const mem = process.memoryUsage();
  const snapshot: WorkerMemorySnapshot = {
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    highWatermark: mem.heapUsed / 1024 / 1024 >= HEAP_HIGH_MB,
    capturedAt: new Date().toISOString(),
  };
  lastSnapshot = snapshot;
  return snapshot;
}

export function getLastWorkerMemorySnapshot(): WorkerMemorySnapshot | null {
  return lastSnapshot;
}

export function isWorkerMemoryHigh(): boolean {
  const mem = process.memoryUsage();
  return mem.heapUsed / 1024 / 1024 >= HEAP_HIGH_MB;
}

/** Queues skipped when heap is above WORKER_HEAP_HIGH_MB. */
export const NONCRITICAL_QUEUES = new Set<string>([
  QUEUES.DISCORD_ENQUEUE,
  QUEUES.DISCORD_DISPATCH,
  QUEUES.DISCORD_NOTIFY,
  QUEUES.PORTFOLIO_RUN,
  QUEUES.WALLET_DISCOVER,
  QUEUES.POSITION_RECONSTRUCT,
]);

export function shouldSkipQueueForMemory(queue: string): boolean {
  return isWorkerMemoryHigh() && NONCRITICAL_QUEUES.has(queue);
}

export function logJobMemory(job: string, queue: string): void {
  const snap = captureWorkerMemory();
  if (snap.highWatermark) {
    console.warn(
      `[worker] memory high job=${job} queue=${queue} heapUsedMb=${snap.heapUsedMb} rssMb=${snap.rssMb}`,
    );
  } else {
    console.log(
      `[worker] memory job=${job} heapUsedMb=${snap.heapUsedMb} rssMb=${snap.rssMb}`,
    );
  }
}
