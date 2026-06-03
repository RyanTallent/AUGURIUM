/** Entry timestamp for shadow pricing (signal time + simulated entry delay). */
export function shadowEntryMs(signalCreatedAt: Date, entryDelayMs: number): number {
  return signalCreatedAt.getTime() + entryDelayMs;
}
