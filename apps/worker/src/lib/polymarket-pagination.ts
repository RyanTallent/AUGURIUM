/** High-offset Polymarket list endpoints return 400/422 when the cursor is past the feed end. */

export function parseOffsetFromUrl(url: string): number {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get("offset");
    const n = raw != null ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function isPaginationOffsetExhausted(status: number, offset: number): boolean {
  return (status === 400 || status === 422) && offset > 0;
}

export class PolymarketPaginationExhaustedError extends Error {
  readonly status: number;
  readonly url: string;
  readonly offset: number;

  constructor(status: number, url: string, offset: number) {
    super(`Polymarket pagination exhausted HTTP ${status} at offset ${offset}`);
    this.name = "PolymarketPaginationExhaustedError";
    this.status = status;
    this.url = url;
    this.offset = offset;
  }
}
