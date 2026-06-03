export interface DrawdownState {
  highWaterMark: number;
  accountValue: number;
  currentDrawdown: number;
  drawdownMode: boolean;
}

export function computeDrawdown(
  accountValue: number,
  priorHighWaterMark: number,
  triggerPct: number,
): DrawdownState {
  const highWaterMark = Math.max(priorHighWaterMark, accountValue);
  const currentDrawdown =
    highWaterMark > 0 ? (highWaterMark - accountValue) / highWaterMark : 0;
  const drawdownMode = currentDrawdown >= triggerPct;
  return { highWaterMark, accountValue, currentDrawdown, drawdownMode };
}
