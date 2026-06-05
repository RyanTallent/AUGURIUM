const MAX_CONCURRENT = Number(process.env.WEB_MAX_CONCURRENT_QUERIES ?? "2");
const DEFAULT_TIMEOUT_MS = Number(process.env.WEB_QUERY_TIMEOUT_MS ?? "25000");

let inFlight = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export async function runWithWebDbGuard<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; allowLiveFallback?: boolean },
): Promise<{ data: T | null; error: string | null; timedOut: boolean; label: string }> {
  if (opts?.allowLiveFallback === false) {
    return { data: null, error: "live fallback disabled", timedOut: false, label };
  }
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  await acquire();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout:${label}`)), timeoutMs);
    });
    const data = await Promise.race([fn(), timeoutPromise]);
    if (timer) clearTimeout(timer);
    return { data, error: null, timedOut: false, label };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      error: message,
      timedOut: message.startsWith("timeout:"),
      label,
    };
  } finally {
    release();
  }
}

export function webMemorySnapshot(): {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  inFlightQueries: number;
} {
  const m = process.memoryUsage();
  return {
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((m.heapTotal / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
    inFlightQueries: inFlight,
  };
}
