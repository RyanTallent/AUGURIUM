import { prisma } from "./client.js";

export interface SignalValidationReport {
  activeByType: Record<string, number>;
  tradeNowRejectedReasons: Record<string, number>;
  tradeNowNearMisses: number;
  recentBaseTradeNowCount: number;
  generatedAt: string;
}

export async function computeSignalValidation(
  lookbackHours = 168,
): Promise<SignalValidationReport> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const recent = await prisma.signal.findMany({
    where: { createdAt: { gte: since } },
    select: {
      signalType: true,
      baseSignalType: true,
      promotionReasons: true,
      status: true,
    },
  });

  const activeByType: Record<string, number> = {};
  const tradeNowRejectedReasons: Record<string, number> = {};
  let tradeNowNearMisses = 0;
  let recentBaseTradeNowCount = 0;

  for (const s of recent) {
    if (s.status === "active") {
      activeByType[s.signalType] = (activeByType[s.signalType] ?? 0) + 1;
    }
    if (s.baseSignalType === "TRADE_NOW") {
      recentBaseTradeNowCount++;
      if (s.signalType !== "TRADE_NOW") tradeNowNearMisses++;
      for (const reason of s.promotionReasons) {
        tradeNowRejectedReasons[reason] = (tradeNowRejectedReasons[reason] ?? 0) + 1;
      }
    }
  }

  return {
    activeByType,
    tradeNowRejectedReasons,
    tradeNowNearMisses,
    recentBaseTradeNowCount,
    generatedAt: new Date().toISOString(),
  };
}
