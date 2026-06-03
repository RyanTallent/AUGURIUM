import { QUEUES, WORKER_QUEUES } from "@augurium/shared";

/** Human-readable job names (npm scripts / ops docs). */
export const QUEUE_JOB_NAMES: Record<string, string> = {
  [QUEUES.TRADER_SCORE]: "score-traders",
  [QUEUES.SIGNAL_GENERATE]: "signal:generate",
  [QUEUES.SHADOW_SYNC]: "shadow:sync",
  [QUEUES.PORTFOLIO_RUN]: "portfolio:run",
  [QUEUES.DISCORD_ENQUEUE]: "discord:enqueue",
  [QUEUES.DISCORD_DISPATCH]: "discord:dispatch",
  [QUEUES.MARKET_INGEST]: "market:ingest",
  [QUEUES.TRADE_INGEST]: "trade:ingest",
  [QUEUES.TRADE_LINK]: "trade:link",
  [QUEUES.WALLET_DISCOVER]: "wallet:discover",
  [QUEUES.WALLET_ACTIVITY]: "wallet:activity",
  [QUEUES.POSITION_SYNC]: "position:sync",
  [QUEUES.POSITION_RECONSTRUCT]: "position:reconstruct",
  [QUEUES.EXECUTION_RUN]: "execution:run",
  [QUEUES.MAINTENANCE_DAILY]: "maintenance:daily",
};

/** Default interval between periodic runs (ms). */
const DEFAULT_INTERVAL_MS: Record<string, number> = {
  [QUEUES.MARKET_INGEST]: 120_000,
  [QUEUES.TRADE_INGEST]: 60_000,
  [QUEUES.TRADE_LINK]: 60_000,
  [QUEUES.WALLET_DISCOVER]: 300_000,
  [QUEUES.WALLET_ACTIVITY]: 120_000,
  [QUEUES.POSITION_SYNC]: 300_000,
  [QUEUES.POSITION_RECONSTRUCT]: 600_000,
  [QUEUES.TRADER_SCORE]: 30_000,
  [QUEUES.SIGNAL_GENERATE]: 120_000,
  [QUEUES.SHADOW_SYNC]: 30_000,
  [QUEUES.DISCORD_ENQUEUE]: 300_000,
  [QUEUES.DISCORD_DISPATCH]: 60_000,
  [QUEUES.PORTFOLIO_RUN]: 300_000,
  [QUEUES.EXECUTION_RUN]: 600_000,
  [QUEUES.MAINTENANCE_DAILY]: 86_400_000,
};

export const PERIODIC_ANALYSIS_QUEUES = [
  QUEUES.TRADER_SCORE,
  QUEUES.SIGNAL_GENERATE,
  QUEUES.SHADOW_SYNC,
  QUEUES.PORTFOLIO_RUN,
  QUEUES.DISCORD_ENQUEUE,
  QUEUES.DISCORD_DISPATCH,
] as const;

function envIntervalKey(queue: string): string {
  return `WORKER_INTERVAL_${queue.replace(/:/g, "_").toUpperCase()}_MS`;
}

export function getQueueIntervalMs(queue: string): number {
  const raw = process.env[envIntervalKey(queue)];
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fallback = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "30000");
  return DEFAULT_INTERVAL_MS[queue] ?? fallback;
}

export function jobNameForQueue(queue: string): string {
  return QUEUE_JOB_NAMES[queue] ?? queue;
}

export function isQueueDue(queue: string, lastRunAtMs: number | undefined, now = Date.now()): boolean {
  if (process.env.WORKER_PERIODIC_JOBS_ENABLED === "false") {
    return false;
  }
  const last = lastRunAtMs ?? 0;
  return now - last >= getQueueIntervalMs(queue);
}

export function formatScheduleSummary(): string {
  return PERIODIC_ANALYSIS_QUEUES.map(
    (q) => `${jobNameForQueue(q)} every ${Math.round(getQueueIntervalMs(q) / 1000)}s`,
  ).join(", ");
}

export { WORKER_QUEUES };
