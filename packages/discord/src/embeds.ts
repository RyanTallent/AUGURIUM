import type { DiscordEmbed, DiscordEventPayload } from "./types.js";

const ADVISORY_FOOTER = "Advisory / shadow simulation — no live execution";
const COLORS = {
  tradeNow: 0x22c55e,
  watchlist: 0x3b82f6,
  research: 0xa855f7,
  shadow: 0x06b6d4,
  trader: 0xeab308,
  risk: 0xef4444,
  weekly: 0x6366f1,
};

function payload(embed: DiscordEmbed): DiscordEventPayload {
  return {
    embeds: [{ ...embed, footer: embed.footer ?? { text: ADVISORY_FOOTER } }],
    advisoryNotice: ADVISORY_FOOTER,
  };
}

export function buildSignalAlertEmbed(input: {
  marketTitle: string;
  side: string;
  signalType: string;
  consensusScore: number;
  alphaScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  triggerTraders: string[];
  reasoning: string;
  whySummary?: string;
  dashboardUrl: string;
}): DiscordEventPayload {
  const traders =
    input.triggerTraders.length > 0
      ? input.triggerTraders.slice(0, 5).join("\n")
      : "—";
  const color =
    input.signalType === "TRADE_NOW"
      ? COLORS.tradeNow
      : input.signalType === "WATCHLIST"
        ? COLORS.watchlist
        : COLORS.research;

  return payload({
    title: `📡 Advisory signal: ${input.signalType}`,
    description: `**${input.marketTitle}** · side **${input.side}**`,
    color,
    url: input.dashboardUrl,
    fields: [
      { name: "Consensus", value: input.consensusScore.toFixed(0), inline: true },
      { name: "Alpha", value: input.alphaScore.toFixed(0), inline: true },
      { name: "Quality", value: input.marketQualityScore.toFixed(0), inline: true },
      { name: "Confidence", value: input.systemConfidenceScore.toFixed(0), inline: true },
      { name: "Trigger traders", value: traders.slice(0, 900) },
      { name: "Reasoning", value: input.reasoning.slice(0, 900) },
      ...(input.whySummary
        ? [{ name: "Why", value: input.whySummary.slice(0, 900) }]
        : []),
      { name: "Dashboard", value: input.dashboardUrl },
    ],
  });
}

export function buildShadowEmbed(input: {
  title: string;
  description: string;
  marketTitle: string;
  side: string;
  roiPct: number;
  pnlUsd: number;
  mfePct?: number;
  whySummary?: string;
  dashboardUrl: string;
}): DiscordEventPayload {
  return payload({
    title: input.title,
    description: input.description,
    color: COLORS.shadow,
    fields: [
      { name: "Market", value: input.marketTitle.slice(0, 200) },
      { name: "Side", value: input.side, inline: true },
      { name: "Sim. ROI", value: `${input.roiPct.toFixed(1)}%`, inline: true },
      { name: "Sim. PnL", value: `$${input.pnlUsd.toFixed(2)}`, inline: true },
      ...(input.mfePct != null
        ? [{ name: "MFE", value: `${input.mfePct.toFixed(1)}%`, inline: true }]
        : []),
      ...(input.whySummary
        ? [{ name: "Why", value: input.whySummary.slice(0, 900) }]
        : []),
      { name: "Dashboard", value: input.dashboardUrl },
    ],
  });
}

export function buildTraderNoveltyEmbed(input: {
  title: string;
  address: string;
  tier: string;
  rankingScore: number;
  copyabilityScore: number;
  informationEdgeScore: number;
  dashboardUrl: string;
}): DiscordEventPayload {
  return payload({
    title: input.title,
    description: `Wallet \`${input.address}\``,
    color: COLORS.trader,
    fields: [
      { name: "Tier", value: input.tier, inline: true },
      { name: "Rank", value: input.rankingScore.toFixed(1), inline: true },
      { name: "Copyability", value: `${(input.copyabilityScore * 100).toFixed(0)}%`, inline: true },
      { name: "Info edge", value: `${(input.informationEdgeScore * 100).toFixed(0)}%`, inline: true },
      { name: "Traders", value: input.dashboardUrl },
    ],
  });
}

export function buildRiskAlertEmbed(input: {
  title: string;
  message: string;
  source?: string;
}): DiscordEventPayload {
  return payload({
    title: `⚠️ ${input.title}`,
    description: input.message.slice(0, 1500),
    color: COLORS.risk,
    fields: input.source ? [{ name: "Source", value: input.source }] : [],
  });
}

export function buildPortfolioEmbed(input: {
  title: string;
  description: string;
  fields: { name: string; value: string; inline?: boolean }[];
  dashboardUrl: string;
}): DiscordEventPayload {
  return payload({
    title: input.title,
    description: input.description,
    color: 0x8b5cf6,
    url: input.dashboardUrl,
    fields: [
      ...input.fields,
      { name: "Dashboard", value: input.dashboardUrl },
    ],
  });
}

export function buildCopyBoardChangeEmbed(input: {
  added: string[];
  removed: string[];
  currentTop: Array<{ address: string; copyScore: number }>;
  dashboardUrl: string;
}): DiscordEventPayload {
  const fmt = (w: string) => `\`${w.slice(0, 6)}…${w.slice(-4)}\``;
  return payload({
    title: "📋 COPY list changed",
    description: "Top efficiency COPY targets updated.",
    color: COLORS.trader,
    fields: [
      {
        name: "Added",
        value: input.added.length ? input.added.map(fmt).join(", ") : "—",
      },
      {
        name: "Removed",
        value: input.removed.length ? input.removed.map(fmt).join(", ") : "—",
      },
      {
        name: "Current top",
        value:
          input.currentTop.length > 0
            ? input.currentTop
                .map((t, i) => `${i + 1}. ${fmt(t.address)} (${t.copyScore.toFixed(0)})`)
                .join("\n")
            : "—",
      },
      { name: "Dashboard", value: `${input.dashboardUrl}/copy` },
    ],
  });
}

export function buildWeeklyReportEmbed(input: {
  weekLabel: string;
  sections: { name: string; value: string }[];
  dashboardUrl: string;
}): DiscordEventPayload {
  return payload({
    title: `📊 AUGURIUM Weekly Intelligence — ${input.weekLabel}`,
    description: "7-day summary of signals, shadow learning, and system health.",
    color: COLORS.weekly,
    fields: [
      ...input.sections.map((s) => ({
        name: s.name,
        value: s.value.slice(0, 900),
      })),
      { name: "Dashboard", value: input.dashboardUrl },
    ],
  });
}
