import { PolymarketPaginationExhaustedError } from "./polymarket.js";
import { advanceCursor } from "./ingestion-store.js";

export async function handlePaginationExhausted(
  stream: string,
  err: PolymarketPaginationExhaustedError,
): Promise<void> {
  await advanceCursor(stream, "0", {
    resetReason: "pagination-offset-exhausted",
    httpStatus: err.status,
    priorOffset: err.offset,
    url: err.url,
  });
  console.warn(
    `[ingest] cursor reset stream=${stream} reason=pagination-offset-exhausted offset=${err.offset} status=${err.status}`,
  );
}

export function isPaginationExhaustedError(err: unknown): err is PolymarketPaginationExhaustedError {
  return err instanceof PolymarketPaginationExhaustedError;
}
