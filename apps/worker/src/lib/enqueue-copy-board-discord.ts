import { getCopyTradingSnapshot } from "@augurium/database";
import type { CopyBoardReport } from "@augurium/copy-trading";
import { buildCopyBoardChangeEmbed, getDiscordConfig } from "@augurium/discord";
import { queueDiscordEvent } from "./discord-events.js";

const TOP_N = 5;

export async function enqueueCopyBoardChangeDiscord(
  board: CopyBoardReport,
): Promise<"queued" | "skipped" | "unchanged"> {
  const config = getDiscordConfig(process.env);
  if (!config.enabled) return "skipped";

  const prev = await getCopyTradingSnapshot<{
    board?: CopyBoardReport;
    lastTopCopyAddresses?: string[];
  }>();

  const current = board.topTradersToday.slice(0, TOP_N).map((t) => t.address);
  const previous = prev?.data?.lastTopCopyAddresses ?? [];

  const added = current.filter((a) => !previous.includes(a));
  const removed = previous.filter((a) => !current.includes(a));

  if (added.length === 0 && removed.length === 0 && previous.length > 0) {
    return "unchanged";
  }
  if (previous.length === 0) {
    return "unchanged";
  }

  const week = new Date().toISOString().slice(0, 10);
  const status = await queueDiscordEvent({
    eventType: "COPY_BOARD_CHANGED",
    dedupeKey: `copy:board:${week}:${current.join(",")}`,
    title: "COPY list changed",
    payload: buildCopyBoardChangeEmbed({
      added,
      removed,
      currentTop: board.topTradersToday.slice(0, TOP_N).map((t) => ({
        address: t.address,
        copyScore: t.copyScore,
      })),
      dashboardUrl: config.dashboardBaseUrl,
    }),
  });

  return status === "PENDING" ? "queued" : "skipped";
}
