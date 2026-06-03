import { prisma } from "@augurium/database";
import { buildPortfolioEmbed } from "@augurium/discord";
import {
  applyLoss,
  computeCompositeScore,
  computeDrawdown,
  evaluateSignalAllocation,
  getPortfolioConfig,
  splitProfits,
  summarizeDeployment,
  updateSimulatedPosition,
  type SignalInputs,
} from "@augurium/portfolio";
import { queueDiscordEvent } from "../lib/discord-events.js";

const PORTFOLIO_STATE_ID = "current";
const SIGNAL_TYPES = ["TRADE_NOW", "WATCHLIST", "RESEARCH"];
const MAX_SIGNALS = Number(process.env.PORTFOLIO_MAX_SIGNALS ?? "150");

export interface PortfolioEngineSummary {
  decisions: number;
  accepted: number;
  watch: number;
  reject: number;
  reallocate: number;
  positionsOpened: number;
  positionsClosed: number;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function dailyLossUsd(): Promise<number> {
  const since = startOfUtcDay(new Date());
  const losses = await prisma.capitalLedgerEntry.findMany({
    where: { entryType: "REALIZED_LOSS", createdAt: { gte: since } },
  });
  return losses.reduce((s, e) => s + Math.abs(e.amount), 0);
}

async function ensurePortfolioState() {
  const config = getPortfolioConfig();
  const existing = await prisma.portfolioState.findUnique({
    where: { id: PORTFOLIO_STATE_ID },
  });
  if (existing) return existing;

  const bankroll = config.initialTradingBankrollUsd;
  await prisma.portfolioState.create({
    data: {
      id: PORTFOLIO_STATE_ID,
      accountValue: bankroll,
      tradingBankroll: bankroll,
      reserveCapital: 0,
      deployedCapital: 0,
      availableCapital: bankroll,
      highWaterMark: bankroll,
    },
  });
  await prisma.capitalLedgerEntry.create({
    data: {
      entryType: "INITIAL_BANKROLL",
      amount: bankroll,
      tradingBankrollAfter: bankroll,
      reserveAfter: 0,
      note: "Phase F simulated initial bankroll",
    },
  });
  return prisma.portfolioState.findUniqueOrThrow({
    where: { id: PORTFOLIO_STATE_ID },
  });
}

function liquidityFromMarket(tradeCount: number, volume: number): number {
  if (tradeCount >= 30 && volume >= 5000) return 85;
  if (tradeCount >= 10) return 60;
  if (tradeCount >= 3) return 40;
  return 20;
}

export async function runPortfolioEngineJob(): Promise<PortfolioEngineSummary> {
  const config = getPortfolioConfig();
  const baseUrl = process.env.AUGURIUM_DASHBOARD_URL ?? "http://localhost:3000";
  const run = await prisma.ingestionRun.create({
    data: { source: "portfolio-engine", status: "running" },
  });

  const summary: PortfolioEngineSummary = {
    decisions: 0,
    accepted: 0,
    watch: 0,
    reject: 0,
    reallocate: 0,
    positionsOpened: 0,
    positionsClosed: 0,
  };

  try {
    let state = await ensurePortfolioState();
    const dailyLoss = await dailyLossUsd();

    const openPositions = await prisma.portfolioPosition.findMany({
      where: { status: "OPEN" },
      include: { signal: true, market: true },
    });

    let tradingBankroll = state.tradingBankroll;
    let reserveCapital = state.reserveCapital;
    let realizedPnl = state.realizedPnl;
    let unrealizedPnl = 0;

    for (const pos of openPositions) {
      const shadow = await prisma.shadowTrade.findUnique({
        where: { signalId: pos.signalId },
      });
      const currentPrice = shadow?.currentPrice ?? pos.currentPrice;
      const entryPrice = shadow?.simulatedEntryPrice ?? pos.entryPrice;

      const upd = updateSimulatedPosition(
        entryPrice,
        currentPrice,
        pos.allocatedUsd,
        pos.positionRemaining,
        pos.realizedPnl,
        pos.partialExitDone,
        pos.runnerActive,
        pos.side,
        {
          currentPrice,
          outcomeSide: pos.side,
          signalExpired: pos.signal.expiresAt
            ? pos.signal.expiresAt < new Date()
            : false,
          signalInactive: pos.signal.status !== "active",
          marketClosed: pos.market.closed ?? false,
          marketResolved: pos.market.resolved ?? false,
          consensusCollapsed: pos.signal.status !== "active",
        },
        config,
      );

      unrealizedPnl += upd.unrealizedPnl;
      realizedPnl += upd.realizedPnl - pos.realizedPnl;

      if (upd.closed) {
        summary.positionsClosed++;
        if (upd.profitSplit) {
          tradingBankroll += upd.profitSplit.reinvestUsd;
          reserveCapital += upd.profitSplit.reserveUsd;
          await prisma.capitalLedgerEntry.createMany({
            data: [
              {
                entryType: "REALIZED_PROFIT",
                amount: upd.realizedPnl,
                tradingBankrollAfter: tradingBankroll,
                reserveAfter: reserveCapital,
                relatedPositionId: pos.id,
                note: upd.closeReason ?? "position closed",
              },
              {
                entryType: "REINVESTMENT",
                amount: upd.profitSplit.reinvestUsd,
                tradingBankrollAfter: tradingBankroll,
                note: "60% profit reinvest",
              },
              {
                entryType: "RESERVE_TRANSFER",
                amount: upd.profitSplit.reserveUsd,
                reserveAfter: reserveCapital,
                note: "40% profit to reserve",
              },
            ],
          });
        } else if (upd.realizedPnl < 0) {
          tradingBankroll = applyLoss(tradingBankroll, Math.abs(upd.realizedPnl));
          await prisma.capitalLedgerEntry.create({
            data: {
              entryType: "REALIZED_LOSS",
              amount: upd.realizedPnl,
              tradingBankrollAfter: tradingBankroll,
              note: upd.closeReason ?? "simulated loss",
            },
          });
        }

        let bestSim: { strategyName: string } | null = null;
        if (shadow?.id) {
          bestSim = await prisma.simulationResult.findFirst({
            where: { shadowTradeId: shadow.id },
            orderBy: { roi: "desc" },
          });
        }

        await prisma.portfolioPosition.update({
          where: { id: pos.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            currentPrice,
            positionRemaining: 0,
            partialExitDone: upd.partialExitDone,
            runnerActive: upd.runnerActive,
            unrealizedPnl: 0,
            realizedPnl: upd.realizedPnl,
            roi: upd.roi,
            missedProfit: upd.missedProfit,
            bestExitStrategy: bestSim?.strategyName ?? null,
          },
        });
      } else {
        await prisma.portfolioPosition.update({
          where: { id: pos.id },
          data: {
            currentPrice,
            positionRemaining: upd.positionRemaining,
            partialExitDone: upd.partialExitDone,
            runnerActive: upd.runnerActive,
            unrealizedPnl: upd.unrealizedPnl,
            realizedPnl: upd.realizedPnl,
            roi: upd.roi,
          },
        });
      }
    }

    const openAfterUpdate = await prisma.portfolioPosition.findMany({
      where: { status: "OPEN" },
    });
    const deployedCapital = openAfterUpdate.reduce((s, p) => s + p.allocatedUsd, 0);
    const accountValue =
      tradingBankroll + reserveCapital + unrealizedPnl + deployedCapital * 0;
    const drawdown = computeDrawdown(
      accountValue,
      state.highWaterMark,
      config.drawdownTriggerPct,
    );

    if (drawdown.drawdownMode && !state.drawdownMode) {
      await prisma.riskEvent.create({
        data: {
          eventType: "DRAWDOWN_MODE",
          severity: "warning",
          message: `Account drawdown ${(drawdown.currentDrawdown * 100).toFixed(1)}% — new sizes halved`,
          metadata: { currentDrawdown: drawdown.currentDrawdown },
        },
      });
      await queueDiscordEvent({
        eventType: "PORTFOLIO_RISK",
        dedupeKey: `portfolio:risk:drawdown:${new Date().toISOString().slice(0, 10)}`,
        title: "Portfolio risk: drawdown mode (simulated)",
        payload: buildPortfolioEmbed({
          title: "⚠️ Simulated drawdown mode",
          description:
            "Advisory portfolio — position sizes reduced 50%. No live trades.",
          fields: [
            {
              name: "Drawdown",
              value: `${(drawdown.currentDrawdown * 100).toFixed(1)}%`,
              inline: true,
            },
            {
              name: "High water mark",
              value: `$${drawdown.highWaterMark.toFixed(2)}`,
              inline: true,
            },
          ],
          dashboardUrl: `${baseUrl}/risk`,
        }),
      });
    }

    const signals = await prisma.signal.findMany({
      where: { status: "active", signalType: { in: SIGNAL_TYPES } },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            category: true,
            closed: true,
            marketQualityScore: true,
          },
        },
      },
      orderBy: { alphaScore: "desc" },
      take: MAX_SIGNALS,
    });

    const openViews = openAfterUpdate.map((p) => ({
      id: p.id,
      signalId: p.signalId,
      marketId: p.marketId,
      category: p.category,
      compositeScore: p.compositeScore,
      allocatedUsd: p.allocatedUsd,
      positionPct: p.positionPct,
    }));

    let acceptCount = 0;
    let watchCount = 0;
    let rejectCount = 0;
    let reallocateCount = 0;
    let largestPct = 0;

    for (const signal of signals) {
      const tradeStats = await prisma.trade.aggregate({
        where: { marketId: signal.marketId },
        _count: true,
        _sum: { size: true },
      });
      const liquidityScore = liquidityFromMarket(
        tradeStats._count,
        tradeStats._sum.size ?? 0,
      );
      const staleSignal =
        !!signal.expiresAt && signal.expiresAt < new Date(Date.now() - 86400000);

      const input: SignalInputs = {
        signalId: signal.id,
        marketId: signal.marketId,
        signalType: signal.signalType,
        side: signal.side,
        alphaScore: signal.alphaScore,
        consensusScore: signal.consensusScore,
        systemConfidenceScore: signal.systemConfidenceScore,
        marketQualityScore: signal.marketQualityScore,
        disagreementScore: signal.disagreementScore,
        category: signal.market.category,
        liquidityScore,
        slippageEstimate: 0.02,
        staleSignal,
        sparseData: signal.triggerTraderWallets.length < 2,
      };

      const result = evaluateSignalAllocation(input, {
        tradingBankroll,
        deployedCapital,
        drawdownMode: drawdown.drawdownMode,
        currentDrawdown: drawdown.currentDrawdown,
        openPositions: openViews,
        dailyLossUsd: dailyLoss,
      });

      summary.decisions++;
      if (result.decision === "ACCEPT") summary.accepted++;
      if (result.decision === "WATCH") summary.watch++;
      if (result.decision === "REJECT") summary.reject++;
      if (result.decision === "REALLOCATE") summary.reallocate++;

      if (result.recommendedPct > largestPct) largestPct = result.recommendedPct;

      await prisma.portfolioDecision.create({
        data: {
          signalId: signal.id,
          marketId: signal.marketId,
          decision: result.decision,
          compositeScore: result.compositeScore,
          riskScore: result.riskScore,
          recommendedSizeUsd: result.recommendedSizeUsd,
          recommendedPct: result.recommendedPct,
          reasons: result.reasons,
          reallocationTargetId: result.reallocationTargetId,
          capViolation: result.capViolation,
        },
      });

      if (result.decision === "ACCEPT" && result.recommendedSizeUsd > 0) {
        const existingPos = await prisma.portfolioPosition.findUnique({
          where: { signalId: signal.id },
        });
        if (!existingPos) {
          const shadow = await prisma.shadowTrade.findUnique({
            where: { signalId: signal.id },
          });
          await prisma.portfolioPosition.create({
            data: {
              signalId: signal.id,
              marketId: signal.marketId,
              side: signal.side,
              allocatedUsd: result.recommendedSizeUsd,
              positionPct: result.recommendedPct,
              compositeScore: result.compositeScore,
              riskScore: result.riskScore,
              alphaScore: signal.alphaScore,
              consensusScore: signal.consensusScore,
              category: signal.market.category,
              entryPrice: shadow?.simulatedEntryPrice ?? 0.5,
              currentPrice: shadow?.currentPrice ?? 0.5,
            },
          });
          await prisma.capitalLedgerEntry.create({
            data: {
              entryType: "SIMULATED_ALLOCATION",
              amount: -result.recommendedSizeUsd,
              tradingBankrollAfter: tradingBankroll,
              note: `simulated allocation signal ${signal.id}`,
            },
          });
          summary.positionsOpened++;
          openViews.push({
            id: "new",
            signalId: signal.id,
            marketId: signal.marketId,
            category: signal.market.category,
            compositeScore: result.compositeScore,
            allocatedUsd: result.recommendedSizeUsd,
            positionPct: result.recommendedPct,
          });
        }
      }

      if (
        result.decision === "ACCEPT" ||
        result.decision === "REALLOCATE" ||
        result.decision === "WATCH"
      ) {
        const dedupe = `portfolio:decision:${signal.id}:${result.decision}`;
        await queueDiscordEvent({
          eventType:
            result.decision === "REALLOCATE"
              ? "PORTFOLIO_REALLOCATE"
              : "PORTFOLIO_DECISION",
          dedupeKey: dedupe,
          title: `Portfolio ${result.decision} (simulated)`,
          payload: buildPortfolioEmbed({
            title: `📋 Simulated portfolio: ${result.decision}`,
            description: `**${signal.market.title}** — advisory only, no live execution.`,
            fields: [
              { name: "Signal", value: signal.signalType, inline: true },
              { name: "Size", value: `$${result.recommendedSizeUsd.toFixed(2)}`, inline: true },
              { name: "Score", value: result.compositeScore.toFixed(0), inline: true },
              { name: "Risk", value: result.riskScore.toFixed(0), inline: true },
              {
                name: "Reasons",
                value: result.reasons.join("; ").slice(0, 500) || "—",
              },
            ],
            dashboardUrl: `${baseUrl}/allocations`,
          }),
        });
      }
    }

    const finalOpen = await prisma.portfolioPosition.findMany({
      where: { status: "OPEN" },
    });
    const finalDeployed = finalOpen.reduce((s, p) => s + p.allocatedUsd, 0);
    const finalUnrealized = finalOpen.reduce((s, p) => s + p.unrealizedPnl, 0);
    const finalAccount =
      tradingBankroll + reserveCapital + finalUnrealized;

    const avgAlpha =
      signals.length > 0
        ? signals.reduce((s, x) => s + x.alphaScore, 0) / signals.length
        : 0;
    const avgConf =
      signals.length > 0
        ? signals.reduce((s, x) => s + x.systemConfidenceScore, 0) / signals.length
        : 0;

    await prisma.portfolioState.update({
      where: { id: PORTFOLIO_STATE_ID },
      data: {
        accountValue: finalAccount,
        tradingBankroll,
        reserveCapital,
        deployedCapital: finalDeployed,
        availableCapital: Math.max(0, tradingBankroll - finalDeployed),
        realizedPnl,
        unrealizedPnl: finalUnrealized,
        highWaterMark: drawdown.highWaterMark,
        currentDrawdown: drawdown.currentDrawdown,
        drawdownMode: drawdown.drawdownMode,
        systemConfidence: avgConf,
        alphaScore: avgAlpha,
      },
    });

    const deploy = summarizeDeployment(finalDeployed, tradingBankroll, largestPct);
    await prisma.portfolioAllocationSnapshot.create({
      data: {
        deployedPct: deploy.deployedPct,
        openPositionCount: finalOpen.length,
        acceptedCount: summary.accepted,
        watchCount: summary.watch,
        rejectCount: summary.reject,
        reallocateCount: summary.reallocate,
        largestPositionPct: deploy.largestPositionPct,
        summary: deploy as object,
      },
    });

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemCount: summary.decisions,
        finishedAt: new Date(),
        metadata: summary as object,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    await prisma.riskEvent.create({
      data: {
        eventType: "PORTFOLIO_ENGINE_FAILURE",
        severity: "error",
        message,
      },
    });
    throw err;
  }

  return summary;
}
