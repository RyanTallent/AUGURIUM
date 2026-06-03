import { buildWeeklyReportEmbed } from "./embeds.js";

export interface WeeklyReportData {
  weekLabel: string;
  totalSignals: number;
  signalDistribution: Record<string, number>;
  shadowCount: number;
  avgShadowRoi: number;
  bestStrategy: { name: string; avgRoi: number } | null;
  worstStrategy: { name: string; avgRoi: number } | null;
  topTradersByRank: { address: string; score: number }[];
  topTradersByCopy: { address: string; score: number }[];
  emergingTraders: { address: string; tier: string }[];
  bestSignals: { market: string; alpha: number; type: string }[];
  worstSignals: { market: string; alpha: number; type: string }[];
  systemConfidence: number;
  weaknesses: string[];
  recommendations: string[];
}

export function buildWeeklyReportPayload(
  data: WeeklyReportData,
  dashboardUrl: string,
) {
  const dist = Object.entries(data.signalDistribution)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

  return buildWeeklyReportEmbed({
    weekLabel: data.weekLabel,
    dashboardUrl,
    sections: [
      { name: "Signals", value: `${data.totalSignals} total (${dist || "—"})` },
      {
        name: "Shadow portfolio",
        value: `${data.shadowCount} trades · avg ROI ${(data.avgShadowRoi * 100).toFixed(2)}%`,
      },
      {
        name: "Best strategy (sim)",
        value: data.bestStrategy
          ? `${data.bestStrategy.name} (${(data.bestStrategy.avgRoi * 100).toFixed(2)}%)`
          : "—",
      },
      {
        name: "Worst strategy (sim)",
        value: data.worstStrategy
          ? `${data.worstStrategy.name} (${(data.worstStrategy.avgRoi * 100).toFixed(2)}%)`
          : "—",
      },
      {
        name: "Top traders (rank)",
        value:
          data.topTradersByRank.map((t) => `${t.address.slice(0, 10)}… ${t.score.toFixed(0)}`).join("\n") ||
          "—",
      },
      {
        name: "Top copyability",
        value:
          data.topTradersByCopy
            .map((t) => `${t.address.slice(0, 10)}… ${(t.score * 100).toFixed(0)}%`)
            .join("\n") || "—",
      },
      {
        name: "Emerging",
        value:
          data.emergingTraders.map((t) => `${t.tier}: ${t.address.slice(0, 12)}…`).join("\n") || "—",
      },
      {
        name: "Best signals",
        value:
          data.bestSignals.map((s) => `${s.type} ${s.market.slice(0, 40)} α${s.alpha.toFixed(0)}`).join("\n") ||
          "—",
      },
      {
        name: "System confidence",
        value: data.systemConfidence.toFixed(0),
      },
      { name: "Known weaknesses", value: data.weaknesses.join("\n") || "—" },
      { name: "Next improvements", value: data.recommendations.join("\n") || "—" },
    ],
  });
}

export function weekDedupeKey(date = new Date()): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return `weekly:${monday.toISOString().slice(0, 10)}`;
}
