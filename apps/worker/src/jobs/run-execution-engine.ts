import { prisma } from "@augurium/database";
import { buildPortfolioEmbed } from "@augurium/discord";
import {
  createExecutionProvider,
  discordDedupeForExecution,
  evaluateExecutionExit,
  evaluateExecutionGates,
  executionModeLabel,
  fillIdempotencyKey,
  getExecutionConfig,
  idempotencyKeyForSignal,
  isLivePolymarketEnabled,
  isPaperExecutionEnabled,
  lockKeyForSignal,
  safeLogMessage,
  type GateCheckInput,
} from "@augurium/execution";
import { getPortfolioConfig } from "@augurium/portfolio";
import { buildReplayPayload } from "@augurium/shadow";
import { queueDiscordEvent } from "../lib/discord-events.js";
import { PrismaLockStore } from "../lib/prisma-lock-store.js";
import { PrismaPaperStore } from "../lib/prisma-paper-store.js";

const LOCK_TTL_MS = 60_000;
const MAX_DECISIONS = Number(process.env.EXECUTION_MAX_DECISIONS ?? "50");

export interface ExecutionEngineSummary {
  eligible: number;
  placed: number;
  blocked: number;
  failed: number;
  exits: number;
  reconciliationStatus: string;
  mode: string;
  message: string;
}

function buildProvider(providerName: string) {
  if (providerName === "paper") {
    return createExecutionProvider(new PrismaPaperStore());
  }
  return createExecutionProvider();
}

async function reconcile(providerName: string): Promise<{
  ok: boolean;
  details: string[];
}> {
  const provider = buildProvider(providerName);
  const sync = await provider.syncPortfolio();
  const dbPositions = await prisma.executionPosition.findMany({
    where: { status: "OPEN", provider: providerName },
  });
  const details: string[] = [];
  if (sync.mismatch) {
    details.push(...(sync.mismatchDetails ?? ["provider sync mismatch"]));
  }
  if (dbPositions.length !== sync.positions.length) {
    details.push(
      `position count db=${dbPositions.length} provider=${sync.positions.length}`,
    );
  }
  const ok = details.length === 0;
  await prisma.executionReconciliation.upsert({
    where: { id: "current" },
    create: {
      id: "current",
      status: ok ? "OK" : "MISMATCH",
      provider: providerName,
      mismatchDetails: ok ? undefined : (details as object),
    },
    update: {
      status: ok ? "OK" : "MISMATCH",
      provider: providerName,
      lastCheckedAt: new Date(),
      mismatchDetails: ok ? undefined : (details as object),
    },
  });
  if (!ok) {
    await prisma.riskEvent.create({
      data: {
        eventType: "EXECUTION_RECONCILIATION",
        severity: "warning",
        message: details.join("; "),
      },
    });
  }
  return { ok, details };
}

async function dailyLossUsd(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.capitalLedgerEntry.findMany({
    where: { entryType: "REALIZED_LOSS", createdAt: { gte: start } },
  });
  return rows.reduce((s, e) => s + Math.abs(e.amount), 0);
}

export async function runExecutionEngineJob(): Promise<ExecutionEngineSummary> {
  const cfg = getExecutionConfig();
  const portfolioCfg = getPortfolioConfig();
  const baseUrl = process.env.AUGURIUM_DASHBOARD_URL ?? "http://localhost:3000";
  const mode = executionModeLabel(cfg);
  const summary: ExecutionEngineSummary = {
    eligible: 0,
    placed: 0,
    blocked: 0,
    failed: 0,
    exits: 0,
    reconciliationStatus: "OK",
    mode,
    message: "",
  };

  const run = await prisma.ingestionRun.create({
    data: { source: "execution-engine", status: "running" },
  });

  try {
    const recon = await reconcile(cfg.provider);
    summary.reconciliationStatus = recon.ok ? "OK" : "MISMATCH";

    if (!cfg.executionEnabled) {
      summary.message = "EXECUTION_ENABLED is false — no orders processed";
      await finishRun(run.id, summary);
      return summary;
    }

    const paperStore = new PrismaPaperStore();
    const provider = buildProvider(cfg.provider);
    const locks = new PrismaLockStore();

    await processExits(provider, paperStore, summary, cfg.provider);

    if (!recon.ok) {
      summary.message = "Reconciliation mismatch — new orders blocked";
      await finishRun(run.id, summary);
      return summary;
    }

    const canRunPaper = isPaperExecutionEnabled(cfg);
    const canRunLive = isLivePolymarketEnabled(cfg);
    if (!canRunPaper && !canRunLive && cfg.provider !== "replay") {
      summary.message = `Execution provider ${cfg.provider} not enabled for trading`;
      await finishRun(run.id, summary);
      return summary;
    }

    if (cfg.provider === "replay") {
      summary.message = "Replay provider — observation only";
      await finishRun(run.id, summary);
      return summary;
    }

    const latestDecisions = await prisma.portfolioDecision.findMany({
      where: { decision: "ACCEPT" },
      orderBy: { createdAt: "desc" },
      distinct: ["signalId"],
      take: MAX_DECISIONS,
    });

    if (latestDecisions.length === 0) {
      summary.message = "no eligible ACCEPT decisions";
      await finishRun(run.id, summary);
      return summary;
    }

    const state = await prisma.portfolioState.findUnique({ where: { id: "current" } });
    const dailyLoss = await dailyLossUsd();
    const cred = await provider.validateCredentials();

    for (const decision of latestDecisions) {
      summary.eligible++;
      const signal = await prisma.signal.findUnique({
        where: { id: decision.signalId },
        include: { market: true },
      });
      if (!signal) continue;

      const existingOrder = await prisma.executionOrder.findUnique({
        where: { idempotencyKey: idempotencyKeyForSignal(signal.id) },
      });
      if (existingOrder) {
        summary.blocked++;
        continue;
      }

      const openSame = await prisma.executionPosition.findFirst({
        where: { marketId: signal.marketId, side: signal.side, status: "OPEN" },
      });
      const openOpp = await prisma.executionPosition.findFirst({
        where: {
          marketId: signal.marketId,
          status: "OPEN",
          side: signal.side === "YES" ? "NO" : signal.side === "NO" ? "YES" : "OTHER",
        },
      });

      const deployedPct = state
        ? state.deployedCapital / Math.max(state.tradingBankroll, 1)
        : 0;

      const gateInput: GateCheckInput = {
        signalType: signal.signalType,
        portfolioDecision: decision.decision,
        marketActive: signal.market.active && !signal.market.closed,
        marketClosed: signal.market.closed,
        hasMockSignal: signal.reasoning.toLowerCase().includes("random"),
        credentialsValid: cred.valid || cfg.provider === "paper",
        reconciliationOk: recon.ok,
        duplicateSignalOrder: !!existingOrder,
        duplicateMarketSide: !!openSame,
        conflictingOppositeSide: !!openOpp && openOpp.side !== signal.side,
        slippageBps: 0,
        maxSlippageBps: cfg.maxSlippageBps,
        deployedPct,
        maxDeployedPct: portfolioCfg.maxDeployedPct,
        positionPct: decision.recommendedPct,
        maxPositionPct: portfolioCfg.absoluteHardCapPct,
        dailyLossUsd: dailyLoss,
        maxDailyLossUsd: portfolioCfg.maxDailyLossUsd,
      };

      const gates = evaluateExecutionGates(gateInput);
      if (!gates.allowed) {
        summary.blocked++;
        await recordBlockedOrder(signal, decision, cfg.provider, mode, gates.reasons);
        await queueExecutionDiscord(
          mode === "LIVE" ? "LIVE" : mode === "PAPER" ? "PAPER" : "BLOCKED",
          "EXECUTION_BLOCKED",
          signal.id,
          `Execution blocked (simulated gate)`,
          gates.reasons.join("; "),
          baseUrl,
        );
        continue;
      }

      const lockKey = lockKeyForSignal(signal.id);
      const acquired = await locks.acquire(lockKey, "execution-engine", LOCK_TTL_MS);
      if (!acquired) {
        summary.blocked++;
        continue;
      }

      try {
        const idem = idempotencyKeyForSignal(signal.id);
        const shadow = await prisma.shadowTrade.findUnique({
          where: { signalId: signal.id },
        });
        const price = shadow?.simulatedEntryPrice ?? shadow?.currentPrice ?? 0.5;

        const result = await provider.placeOrder({
          idempotencyKey: idem,
          signalId: signal.id,
          portfolioDecisionId: decision.id,
          marketId: signal.marketId,
          conditionId: signal.conditionId,
          side: signal.side,
          outcome: signal.outcome,
          orderType: "LIMIT",
          requestedSizeUsd: decision.recommendedSizeUsd,
          requestedPrice: price,
        });

        if (!result.success) {
          summary.failed++;
          await prisma.executionOrder.create({
            data: {
              idempotencyKey: idem,
              signalId: signal.id,
              portfolioDecisionId: decision.id,
              provider: cfg.provider,
              mode,
              marketId: signal.marketId,
              side: signal.side,
              outcome: signal.outcome,
              requestedSizeUsd: decision.recommendedSizeUsd,
              requestedPrice: price,
              status: "FAILED",
              errorMessage: safeLogMessage(result.errorMessage ?? "unknown"),
            },
          });
          await queueExecutionDiscord(
            mode,
            "EXECUTION_ERROR",
            signal.id,
            "Execution error",
            result.errorMessage ?? "failed",
            baseUrl,
          );
          continue;
        }

        const dbOrder = await prisma.executionOrder.findUnique({
          where: { idempotencyKey: idem },
        });
        const orderId = dbOrder?.id ?? result.providerOrderId ?? `paper-${idem}`;

        if (result.filledSizeUsd && result.filledSizeUsd > 0) {
          await prisma.executionFill.upsert({
            where: { idempotencyKey: fillIdempotencyKey(orderId, 0) },
            create: {
              orderId,
              idempotencyKey: fillIdempotencyKey(orderId, 0),
              fillPrice: result.fillPrice ?? price,
              filledSizeUsd: result.filledSizeUsd,
              partial: result.partial ?? false,
            },
            update: {},
          });
        }

        await prisma.executionAuditLog.create({
          data: {
            action: "ORDER_PLACED",
            provider: cfg.provider,
            message: `${mode} order ${orderId}`,
            metadata: { signalId: signal.id, status: result.status },
          },
        });

        await storeReplaySnapshot(signal);

        summary.placed++;
        const alertTitle =
          mode === "LIVE"
            ? "LIVE EXECUTION (real money)"
            : "PAPER EXECUTION (simulated)";
        await queueExecutionDiscord(
          mode,
          "EXECUTION_FILLED",
          signal.id,
          alertTitle,
          `Filled $${(result.filledSizeUsd ?? 0).toFixed(2)} @ ${(result.fillPrice ?? price).toFixed(3)}`,
          baseUrl,
        );
      } finally {
        await locks.release(lockKey, "execution-engine");
      }
    }

    summary.message =
      summary.placed > 0
        ? `placed ${summary.placed} orders`
        : summary.eligible > 0
          ? "no orders placed (blocked or failed)"
          : "no eligible ACCEPT decisions";

    await finishRun(run.id, summary);
    return summary;
  } catch (err) {
    const message = safeLogMessage(err instanceof Error ? err.message : String(err));
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}

async function finishRun(runId: string, summary: ExecutionEngineSummary): Promise<void> {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: "success",
      itemCount: summary.placed + summary.blocked,
      finishedAt: new Date(),
      metadata: summary as object,
    },
  });
}

async function recordBlockedOrder(
  signal: { id: string; marketId: string; side: string; outcome: string | null },
  decision: { id: string; recommendedSizeUsd: number },
  provider: string,
  mode: string,
  reasons: string[],
): Promise<void> {
  const idem = idempotencyKeyForSignal(signal.id);
  const existing = await prisma.executionOrder.findUnique({ where: { idempotencyKey: idem } });
  if (existing) return;
  await prisma.executionOrder.create({
    data: {
      idempotencyKey: idem,
      signalId: signal.id,
      portfolioDecisionId: decision.id,
      provider,
      mode,
      marketId: signal.marketId,
      side: signal.side,
      outcome: signal.outcome,
      requestedSizeUsd: decision.recommendedSizeUsd,
      status: "BLOCKED",
      blockReason: reasons.join("; ").slice(0, 500),
    },
  });
}

async function processExits(
  provider: ReturnType<typeof createExecutionProvider>,
  _store: PrismaPaperStore,
  summary: ExecutionEngineSummary,
  providerName: string,
): Promise<void> {
  const positions = await prisma.executionPosition.findMany({
    where: { status: "OPEN", provider: providerName },
    include: { market: true },
  });

  for (const pos of positions) {
    const signal = pos.signalId
      ? await prisma.signal.findUnique({ where: { id: pos.signalId } })
      : null;
    const exit = evaluateExecutionExit(
      {
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        sizeUsd: pos.sizeUsd,
        positionRemaining: pos.positionRemaining,
        realizedPnl: pos.realizedPnl,
        partialExitDone: pos.partialExitDone,
        runnerActive: pos.runnerActive,
        side: pos.side,
      },
      {
        currentPrice: pos.currentPrice,
        outcomeSide: pos.side,
        signalExpired: signal?.expiresAt ? signal.expiresAt < new Date() : false,
        signalInactive: signal?.status !== "active",
        marketClosed: pos.market.closed,
        marketResolved: pos.market.resolved ?? false,
        consensusCollapsed: signal?.status !== "active",
      },
    );

    if (!exit.shouldClose || exit.closeFraction <= 0) continue;

    const closeKey = `exit:${pos.id}:${exit.partialExit ? "partial" : "full"}`;
    const prior = await prisma.executionAuditLog.findFirst({
      where: { action: "EXIT", metadata: { path: ["positionId"], equals: pos.id } },
    });
    if (prior && exit.partialExit && pos.partialExitDone) continue;

    if (providerName !== "paper") continue;

    const result = await provider.closePosition(pos.id, exit.closeFraction);
    if (result.success) {
      summary.exits++;
      await prisma.executionPosition.update({
        where: { id: pos.id },
        data: {
          positionRemaining: exit.state.positionRemaining,
          partialExitDone: exit.state.partialExitDone,
          runnerActive: exit.state.runnerActive,
          realizedPnl: exit.state.realizedPnl,
          currentPrice: exit.state.currentPrice,
          status: exit.state.positionRemaining <= 0 ? "CLOSED" : "OPEN",
          closedAt: exit.state.positionRemaining <= 0 ? new Date() : null,
        },
      });
      await prisma.executionAuditLog.create({
        data: {
          action: "EXIT",
          provider: providerName,
          message: exit.reason ?? "exit",
          metadata: { positionId: pos.id, closeKey },
        },
      });
    }
  }
}

async function storeReplaySnapshot(signal: {
  id: string;
  marketId: string;
  side: string;
  signalType: string;
  reasoning: string;
  alphaScore: number;
  consensusScore: number;
  marketQualityScore: number;
  systemConfidenceScore: number;
  createdAt: Date;
}): Promise<void> {
  const market = await prisma.market.findUnique({ where: { id: signal.marketId } });
  if (!market) return;
  const payload = buildReplayPayload({
    capturedAt: new Date(),
    signal: signal as unknown as Record<string, unknown>,
    market: market as unknown as Record<string, unknown>,
    recentTrades: [],
    triggerTraders: [],
    simulatedSizeUsd: 0,
    entryDelayMs: 0,
    entryDelayLabel: "execution",
    reasoning: signal.reasoning,
  });
  await prisma.replaySnapshot.create({
    data: { signalId: signal.id, payload: payload as object },
  });
}

async function queueExecutionDiscord(
  mode: string,
  eventType: string,
  signalId: string,
  title: string,
  description: string,
  baseUrl: string,
): Promise<void> {
  const discordType =
    eventType === "EXECUTION_BLOCKED"
      ? "EXECUTION_BLOCKED"
      : eventType === "EXECUTION_ERROR"
        ? "EXECUTION_ERROR"
        : mode === "LIVE"
          ? "EXECUTION_LIVE"
          : "EXECUTION_PAPER";

  await queueDiscordEvent({
    eventType: discordType as "EXECUTION_PAPER",
    dedupeKey: discordDedupeForExecution(mode, signalId, eventType),
    title,
    payload: buildPortfolioEmbed({
      title,
      description,
      fields: [{ name: "Detail", value: description.slice(0, 500) }],
      dashboardUrl: `${baseUrl}/execution`,
    }),
  });
}
