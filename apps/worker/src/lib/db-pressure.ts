/** Detect Postgres pool exhaustion / connectivity failures from Prisma/driver errors. */
export function isDbPressureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /connection pool|Can't reach database|Timed out fetching|P1001|P2024|ECONNREFUSED|too many clients/i.test(
    msg,
  );
}
