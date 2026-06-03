import { prisma } from "./client.js";

export interface ShadowDuplicateReport {
  duplicateActiveGroups: number;
  duplicateActivePositions: number;
  duplicateMarkets: string[];
  duplicateSignals: string[];
  groups: Array<{
    marketId: string;
    side: string;
    signalType: string;
    count: number;
    shadowIds: string[];
  }>;
  generatedAt: string;
}

export async function auditShadowDuplicates(): Promise<ShadowDuplicateReport> {
  const open = await prisma.shadowTrade.findMany({
    where: { status: "OPEN" },
    select: {
      id: true,
      marketId: true,
      side: true,
      signalType: true,
      signalId: true,
    },
  });

  const groups = new Map<string, typeof open>();
  for (const row of open) {
    const key = `${row.marketId}|${row.side}|${row.signalType}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const dupGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const groupSummaries = dupGroups.map(([key, rows]) => {
    const [marketId, side, signalType] = key.split("|");
    return {
      marketId: marketId!,
      side: side!,
      signalType: signalType!,
      count: rows.length,
      shadowIds: rows.map((r) => r.id),
    };
  });

  return {
    duplicateActiveGroups: dupGroups.length,
    duplicateActivePositions: dupGroups.reduce((s, [, rows]) => s + rows.length, 0),
    duplicateMarkets: [...new Set(groupSummaries.map((g) => g.marketId))],
    duplicateSignals: open.map((r) => r.signalId),
    groups: groupSummaries,
    generatedAt: new Date().toISOString(),
  };
}
