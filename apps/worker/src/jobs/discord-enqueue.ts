import { prisma } from "@augurium/database";
import {
  buildRiskAlertEmbed,
  buildShadowEmbed,
  buildSignalAlertEmbed,
  buildTraderNoveltyEmbed,
  buildWeeklyReportPayload,
  buildLiveCopyTradeEmbed,
  getDiscordConfig,
  weekDedupeKey,
} from "@augurium/discord";
import { queueDiscordEvent } from "../lib/discord-events.js";

const RESEARCH_ALPHA_MIN = Number(process.env.DISCORD_RESEARCH_ALPHA_MIN ?? "55");
const LIVE_COPY_ONLY = process.env.DISCORD_LIVE_COPY_ONLY === "true";

export interface DiscordEnqueueSummary {
  queued: number;
  skipped: number;
}

export async function runDiscordEnqueueJob(): Promise<DiscordEnqueueSummary> {
  const config = getDiscordConfig(process.env);
  const base = config.dashboardBaseUrl;
  let queued = 0;
  let skipped = 0;

  const run = await prisma.ingestionRun.create({
    data: { source: "discord-enqueue", status: "running" },
  });

  try {
    const liveMirrors = await prisma.copyLiveMirror.findMany({
      where: { status: { in: ["SUBMITTED", "OPEN"] } },
      include: {
        trader: { select: { address: true } },
        market: { select: { title: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 30,
    });

    for (const m of liveMirrors) {
      const st = await queueDiscordEvent({
        eventType: "EXECUTION_LIVE",
        dedupeKey: `copy:live:submitted:${m.id}`,
        title: `Live copy submitted: ${m.market.title.slice(0, 48)}`,
        payload: buildLiveCopyTradeEmbed({
          kind: "submitted",
          marketTitle: m.market.title,
          side: m.side,
          sizeUsd: m.requestedSizeUsd,
          entryPrice: m.entryPrice,
          traderAddress: m.trader.address,
          providerOrderId: m.providerOrderId,
          dashboardUrl: `${base}/copy`,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    if (LIVE_COPY_ONLY) {
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          itemCount: queued,
          finishedAt: new Date(),
          metadata: { queued, skipped, liveCopyOnly: true },
        },
      });
      return { queued, skipped };
    }

    const signalTypes = ["TRADE_NOW", "WATCHLIST"];
    const signals = await prisma.signal.findMany({
      where: {
        status: "active",
        OR: [
          { signalType: { in: signalTypes } },
          {
            signalType: "RESEARCH",
            alphaScore: { gte: RESEARCH_ALPHA_MIN },
          },
        ],
      },
      include: { market: { select: { title: true, slug: true } } },
      orderBy: { alphaScore: "desc" },
      take: 30,
    });

    for (const s of signals) {
      const whySummary =
        s.signalType === "TRADE_NOW"
          ? `Consensus ${s.consensusScore.toFixed(0)}, alpha ${s.alphaScore.toFixed(0)}, ${s.triggerTraderWallets.length} scored traders, $${s.triggerNotional.toFixed(0)} notional`
          : s.promotionReasons.length > 0
            ? `Blocked: ${s.promotionReasons.join(", ")}`
            : s.reasoning.slice(0, 200);

      const status = await queueDiscordEvent({
        eventType: "SIGNAL_ALERT",
        dedupeKey: `signal:alert:${s.id}`,
        title: `Signal ${s.signalType}: ${s.market.title}`,
        payload: buildSignalAlertEmbed({
          marketTitle: s.market.title,
          side: s.side,
          signalType: s.signalType,
          consensusScore: s.consensusScore,
          alphaScore: s.alphaScore,
          marketQualityScore: s.marketQualityScore,
          systemConfidenceScore: s.systemConfidenceScore,
          triggerTraders: s.triggerTraderWallets,
          reasoning: s.reasoning,
          whySummary,
          dashboardUrl: `${base}/signals`,
        }),
      });
      if (status === "PENDING") queued++;
      else skipped++;

      if (s.signalType === "TRADE_NOW") {
        const hc = await queueDiscordEvent({
          eventType: "HIGH_CONVICTION_SIGNAL",
          dedupeKey: `signal:high-conviction:${s.id}`,
          title: `HIGH_CONVICTION: ${s.market.title}`,
          payload: buildSignalAlertEmbed({
            marketTitle: s.market.title,
            side: s.side,
            signalType: "TRADE_NOW",
            consensusScore: s.consensusScore,
            alphaScore: s.alphaScore,
            marketQualityScore: s.marketQualityScore,
            systemConfidenceScore: s.systemConfidenceScore,
            triggerTraders: s.triggerTraderWallets,
            reasoning: s.reasoning,
            whySummary,
            dashboardUrl: `${base}/signals`,
          }),
        });
        if (hc === "PENDING") queued++;
        else skipped++;
      }
    }

    const shadows = await prisma.shadowTrade.findMany({
      include: { market: { select: { title: true } }, signal: { select: { signalType: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    for (const sh of shadows) {
      const pnl = sh.realizedPnl + sh.unrealizedPnl;
      const roiPct = sh.roi * 100;

      const openStatus = await queueDiscordEvent({
        eventType: "SHADOW_OPENED",
        dedupeKey: `shadow:opened:${sh.id}`,
        title: `Shadow opened (simulation)`,
        payload: buildShadowEmbed({
          title: "🟦 Shadow trade opened (simulated)",
          description: `Advisory signal **${sh.signal.signalType}** — not a live trade.`,
          marketTitle: sh.market.title,
          side: sh.side,
          roiPct,
          pnlUsd: pnl,
          dashboardUrl: `${base}/shadow`,
        }),
      });
      if (openStatus === "PENDING") queued++;
      else skipped++;

      if (sh.partialExitDone) {
        const st = await queueDiscordEvent({
          eventType: "SHADOW_PARTIAL_PROFIT",
          dedupeKey: `shadow:partial:${sh.id}`,
          title: `Shadow +20% partial (sim)`,
          payload: buildShadowEmbed({
            title: "💰 Simulated +20% — 85% profit taken",
            description: "Augurium shadow rules: partial exit at +20%, 15% runner remains.",
            marketTitle: sh.market.title,
            side: sh.side,
            roiPct,
            pnlUsd: pnl,
            mfePct: sh.maxFavorableExcursion * 100,
            dashboardUrl: `${base}/shadow`,
          }),
        });
        if (st === "PENDING") queued++;
        else skipped++;

        if (sh.runnerActive) {
          const rt = await queueDiscordEvent({
            eventType: "SHADOW_RUNNER_CREATED",
            dedupeKey: `shadow:runner:${sh.id}`,
            title: `Shadow runner active`,
            payload: buildShadowEmbed({
              title: "🏃 Shadow runner (15% simulated position)",
              description: "Runner targets +50% ROI or signal/market exit.",
              marketTitle: sh.market.title,
              side: sh.side,
              roiPct,
              pnlUsd: pnl,
              dashboardUrl: `${base}/shadow`,
            }),
          });
          if (rt === "PENDING") queued++;
          else skipped++;
        }
      }

      if (sh.partialExitDone && !sh.runnerActive && (sh.status === "CLOSED" || sh.status === "EXPIRED")) {
        const re = await queueDiscordEvent({
          eventType: "SHADOW_RUNNER_EXIT",
          dedupeKey: `shadow:runner-exit:${sh.id}`,
          title: `Shadow runner exited`,
          payload: buildShadowEmbed({
            title: "🏁 Shadow runner exited (simulation)",
            description: "Runner closed with remaining simulated position.",
            marketTitle: sh.market.title,
            side: sh.side,
            roiPct,
            pnlUsd: pnl,
            dashboardUrl: `${base}/shadow`,
          }),
        });
        if (re === "PENDING") queued++;
        else skipped++;
      }

      if (sh.status === "CLOSED" || sh.status === "EXPIRED") {
        if (roiPct >= 5) {
          const win = await queueDiscordEvent({
            eventType: "SHADOW_WINNER",
            dedupeKey: `shadow:winner:${sh.id}`,
            title: `Shadow winner +${roiPct.toFixed(1)}%`,
            payload: buildShadowEmbed({
              title: "✅ SHADOW_WINNER (simulation)",
              description: sh.latestReasoning.slice(0, 400),
              marketTitle: sh.market.title,
              side: sh.side,
              roiPct,
              pnlUsd: pnl,
              mfePct: sh.maxFavorableExcursion * 100,
              whySummary: `Closed ${sh.status} with +${roiPct.toFixed(1)}% ROI — ${sh.latestReasoning.slice(0, 120)}`,
              dashboardUrl: `${base}/shadow/analytics`,
            }),
          });
          if (win === "PENDING") queued++;
          else skipped++;
        } else if (roiPct <= -5) {
          const loss = await queueDiscordEvent({
            eventType: "SHADOW_LOSER",
            dedupeKey: `shadow:loser:${sh.id}`,
            title: `Shadow loser ${roiPct.toFixed(1)}%`,
            payload: buildShadowEmbed({
              title: "❌ SHADOW_LOSER (simulation)",
              description: sh.latestReasoning.slice(0, 400),
              marketTitle: sh.market.title,
              side: sh.side,
              roiPct,
              pnlUsd: pnl,
              mfePct: sh.maxFavorableExcursion * 100,
              whySummary: `Closed ${sh.status} with ${roiPct.toFixed(1)}% ROI — ${sh.latestReasoning.slice(0, 120)}`,
              dashboardUrl: `${base}/shadow/analytics`,
            }),
          });
          if (loss === "PENDING") queued++;
          else skipped++;
        }

        const ct = await queueDiscordEvent({
          eventType: "SHADOW_CLOSED",
          dedupeKey: `shadow:closed:${sh.id}`,
          title: `Shadow closed (${sh.status})`,
          payload: buildShadowEmbed({
            title: `⏹️ Shadow trade ${sh.status.toLowerCase()} (simulation)`,
            description: sh.latestReasoning.slice(0, 400),
            marketTitle: sh.market.title,
            side: sh.side,
            roiPct,
            pnlUsd: pnl,
            mfePct: sh.maxFavorableExcursion * 100,
            dashboardUrl: `${base}/shadow`,
          }),
        });
        if (ct === "PENDING") queued++;
        else skipped++;

        if (sh.wouldHaveBeenBetterToHold) {
          const mp = await queueDiscordEvent({
            eventType: "SHADOW_MISSED_PROFIT",
            dedupeKey: `shadow:missed:${sh.id}`,
            title: `Shadow missed profit warning`,
            payload: buildShadowEmbed({
              title: "⚠️ Holding would have been better (simulation)",
              description: `Missed ~$${sh.missedProfitAfterExit.toFixed(2)} vs MFE.`,
              marketTitle: sh.market.title,
              side: sh.side,
              roiPct,
              pnlUsd: pnl,
              mfePct: sh.maxFavorableExcursion * 100,
              dashboardUrl: `${base}/shadow`,
            }),
          });
          if (mp === "PENDING") queued++;
          else skipped++;
        }
      }
    }

    const rising = await prisma.trader.findMany({
      where: { tier: { in: ["RISING", "PROSPECT", "ELITE", "SUPER_ELITE"] } },
      orderBy: { rankingScore: "desc" },
      take: 10,
    });

    for (const t of rising) {
      const eventType = t.tier === "RISING" ? "TRADER_RISING" : "TRADER_EMERGING";
      const st = await queueDiscordEvent({
        eventType,
        dedupeKey: `trader:${eventType}:${t.id}`,
        title: `${t.tier} trader`,
        payload: buildTraderNoveltyEmbed({
          title:
            t.tier === "RISING"
              ? "📈 Rising trader detected"
              : "🌱 Emerging / prospect trader",
          address: t.address,
          tier: t.tier,
          rankingScore: t.rankingScore,
          copyabilityScore: t.copyabilityScore,
          informationEdgeScore: t.informationEdgeScore,
          dashboardUrl: `${base}/traders/${t.address}`,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    const highCopy = await prisma.trader.findMany({
      where: { copyabilityScore: { gte: 0.85 }, lastScoredAt: { not: null } },
      orderBy: { copyabilityScore: "desc" },
      take: 5,
    });
    for (const t of highCopy) {
      const st = await queueDiscordEvent({
        eventType: "TRADER_HIGH_COPYABILITY",
        dedupeKey: `trader:copy:${t.id}`,
        title: `High copyability: ${t.address.slice(0, 10)}`,
        payload: buildTraderNoveltyEmbed({
          title: "🎯 High-copyability trader",
          address: t.address,
          tier: t.tier,
          rankingScore: t.rankingScore,
          copyabilityScore: t.copyabilityScore,
          informationEdgeScore: t.informationEdgeScore,
          dashboardUrl: `${base}/traders/${t.address}`,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    const highEdge = await prisma.trader.findMany({
      where: { informationEdgeScore: { gte: 0.75 } },
      orderBy: { informationEdgeScore: "desc" },
      take: 5,
    });
    for (const t of highEdge) {
      const st = await queueDiscordEvent({
        eventType: "TRADER_INFORMATION_EDGE",
        dedupeKey: `trader:edge:${t.id}`,
        title: `Information edge: ${t.address.slice(0, 10)}`,
        payload: buildTraderNoveltyEmbed({
          title: "🧠 Unusual information-edge trader",
          address: t.address,
          tier: t.tier,
          rankingScore: t.rankingScore,
          copyabilityScore: t.copyabilityScore,
          informationEdgeScore: t.informationEdgeScore,
          dashboardUrl: `${base}/traders/${t.address}`,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    const failedRuns = await prisma.ingestionRun.findMany({
      where: { status: "error", startedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { startedAt: "desc" },
      take: 10,
    });
    for (const r of failedRuns) {
      const st = await queueDiscordEvent({
        eventType: "RISK_SYSTEM",
        dedupeKey: `risk:ingest:${r.id}`,
        title: `Ingestion failure: ${r.source}`,
        payload: buildRiskAlertEmbed({
          title: "System alert",
          message: r.error ?? "Unknown ingestion error",
          source: r.source,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    const lastTrade = await prisma.trade.findFirst({ orderBy: { tradedAt: "desc" } });
    if (lastTrade && lastTrade.tradedAt.getTime() < Date.now() - 48 * 3600_000) {
      const st = await queueDiscordEvent({
        eventType: "RISK_SYSTEM",
        dedupeKey: `risk:stale-trades:${lastTrade.tradedAt.toISOString().slice(0, 10)}`,
        title: "Stale market data",
        payload: buildRiskAlertEmbed({
          title: "Stale trade data",
          message: `Last trade at ${lastTrade.tradedAt.toISOString()}. Check ingestion.`,
        }),
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    const weekKey = weekDedupeKey();
    const existingWeekly = await prisma.discordEvent.findUnique({
      where: { dedupeKey: weekKey },
    });
    const forceWeekly = process.env.DISCORD_FORCE_WEEKLY === "true";
    if (!existingWeekly || forceWeekly) {
      if (existingWeekly && forceWeekly) {
        await prisma.discordEvent.delete({ where: { dedupeKey: weekKey } }).catch(() => {});
      }

      const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
      const [signalCounts, shadowStats, strategies, topTraders, topCopy, emerging] =
        await Promise.all([
          prisma.signal.groupBy({ by: ["signalType"], _count: true, where: { createdAt: { gte: weekAgo } } }),
          prisma.shadowTrade.aggregate({ _avg: { roi: true }, _count: true }),
          prisma.simulationResult.groupBy({
            by: ["strategyName"],
            _avg: { roi: true },
            where: { createdAt: { gte: weekAgo } },
          }),
          prisma.trader.findMany({
            orderBy: { rankingScore: "desc" },
            take: 5,
            select: { address: true, rankingScore: true },
          }),
          prisma.trader.findMany({
            orderBy: { copyabilityScore: "desc" },
            take: 5,
            select: { address: true, copyabilityScore: true },
          }),
          prisma.trader.findMany({
            where: { tier: { in: ["RISING", "PROSPECT"] } },
            take: 5,
            select: { address: true, tier: true },
          }),
        ]);

      const dist: Record<string, number> = {};
      let totalSignals = 0;
      for (const row of signalCounts) {
        dist[row.signalType] = row._count;
        totalSignals += row._count;
      }

      const stratSorted = strategies
        .map((s) => ({ name: s.strategyName, avgRoi: s._avg.roi ?? 0 }))
        .sort((a, b) => b.avgRoi - a.avgRoi);

      const bestSignals = await prisma.signal.findMany({
        orderBy: { alphaScore: "desc" },
        take: 3,
        include: { market: { select: { title: true } } },
      });
      const worstSignals = await prisma.signal.findMany({
        where: { signalType: "IGNORE" },
        orderBy: { alphaScore: "asc" },
        take: 3,
        include: { market: { select: { title: true } } },
      });

      const avgConf = await prisma.signal.aggregate({
        _avg: { systemConfidenceScore: true },
        where: { createdAt: { gte: weekAgo } },
      });

      const payload = buildWeeklyReportPayload(
        {
          weekLabel: weekKey.replace("weekly:", ""),
          totalSignals,
          signalDistribution: dist,
          shadowCount: shadowStats._count,
          avgShadowRoi: shadowStats._avg.roi ?? 0,
          bestStrategy: stratSorted[0] ?? null,
          worstStrategy: stratSorted[stratSorted.length - 1] ?? null,
          topTradersByRank: topTraders.map((t) => ({
            address: t.address,
            score: t.rankingScore,
          })),
          topTradersByCopy: topCopy.map((t) => ({
            address: t.address,
            score: t.copyabilityScore,
          })),
          emergingTraders: emerging.map((t) => ({
            address: t.address,
            tier: t.tier,
          })),
          bestSignals: bestSignals.map((s) => ({
            market: s.market.title,
            alpha: s.alphaScore,
            type: s.signalType,
          })),
          worstSignals: worstSignals.map((s) => ({
            market: s.market.title,
            alpha: s.alphaScore,
            type: s.signalType,
          })),
          systemConfidence: avgConf._avg.systemConfidenceScore ?? 0,
          weaknesses: [
            "Most signals RESEARCH due to thin multi-trader consensus",
            "Categories often uncategorized",
            "Shadow ROI depends on post-signal tape density",
          ],
          recommendations: [
            "Ingest more wallet activity before raising TRADE_NOW bar",
            "Map Gamma categories for specialist detection",
            "Re-run shadow sync after trade bursts",
          ],
        },
        `${base}/reports`,
      );

      const st = await queueDiscordEvent({
        eventType: "WEEKLY_REPORT",
        dedupeKey: weekKey,
        title: `Weekly intelligence ${weekKey}`,
        payload,
      });
      if (st === "PENDING") queued++;
      else skipped++;
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: queued,
        finishedAt: new Date(),
        metadata: { queued, skipped },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    throw err;
  }

  return { queued, skipped };
}
