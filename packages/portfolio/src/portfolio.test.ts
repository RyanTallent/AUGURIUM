import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSignalAllocation } from "./allocation.js";
import { splitProfits, applyLoss } from "./capital.js";
import { computeDrawdown } from "./drawdown.js";
import { getPortfolioConfig } from "./config.js";
import {
  basePositionPctFromScore,
  applySizingModifiers,
  clampPositionPct,
} from "./sizing.js";
import { computeRiskScore } from "./risk-score.js";
import { isMaxDeployed, wouldExceedDeployedCap } from "./limits.js";
import { EXECUTION_DISABLED, updateSimulatedPosition } from "./profit.js";
import type { PortfolioContext, SignalInputs } from "./types.js";

function baseSignal(overrides: Partial<SignalInputs> = {}): SignalInputs {
  return {
    signalId: "s1",
    marketId: "m1",
    signalType: "TRADE_NOW",
    side: "YES",
    alphaScore: 92,
    consensusScore: 88,
    systemConfidenceScore: 75,
    marketQualityScore: 70,
    disagreementScore: 0.1,
    category: "politics",
    liquidityScore: 70,
    slippageEstimate: 0.01,
    staleSignal: false,
    sparseData: false,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
  return {
    tradingBankroll: 70,
    deployedCapital: 0,
    drawdownMode: false,
    currentDrawdown: 0,
    openPositions: [],
    dailyLossUsd: 0,
    ...overrides,
  };
}

describe("position sizing tiers", () => {
  it("maps score bands to bankroll %", () => {
    assert.equal(basePositionPctFromScore(96), 0.1);
    assert.equal(basePositionPctFromScore(91), 0.08);
    assert.equal(basePositionPctFromScore(87), 0.06);
    assert.equal(basePositionPctFromScore(82), 0.04);
    assert.equal(basePositionPctFromScore(79), 0);
  });
});

describe("drawdown size reduction", () => {
  it("halves size in drawdown mode", () => {
    const { pct, reasons } = applySizingModifiers(0.1, {
      systemConfidence: 80,
      marketQuality: 80,
      liquidityScore: 80,
      drawdownMode: true,
      duplicateMarket: false,
      categoryOverCap: false,
    });
    assert.equal(pct, 0.05);
    assert.ok(reasons.some((r) => r.includes("drawdown")));
  });

  it("enters drawdown mode at 10% from high water mark", () => {
    const d = computeDrawdown(90, 100, 0.1);
    assert.equal(d.drawdownMode, true);
    assert.ok(d.currentDrawdown >= 0.1);
  });
});

describe("portfolio limits", () => {
  it("detects max deployed capital", () => {
    const cfg = getPortfolioConfig();
    assert.ok(isMaxDeployed(56, 70, cfg));
    assert.ok(!isMaxDeployed(50, 70, cfg));
  });

  it("single position caps", () => {
    const cfg = getPortfolioConfig();
    const normal = clampPositionPct(0.2, 85, cfg);
    assert.equal(normal.pct, cfg.normalMaxPositionPct);
    const exceptional = clampPositionPct(0.3, 95, cfg);
    assert.equal(exceptional.pct, cfg.exceptionalMaxPositionPct);
    assert.equal(exceptional.exceptional, true);
    const hard = clampPositionPct(0.5, 88, cfg);
    assert.equal(hard.pct, cfg.normalMaxPositionPct);
  });
});

describe("profit split 60/40", () => {
  it("splits realized profit", () => {
    const cfg = getPortfolioConfig();
    const split = splitProfits(10, cfg);
    assert.equal(split.reinvestUsd, 6);
    assert.equal(split.reserveUsd, 4);
  });

  it("losses reduce bankroll", () => {
    assert.equal(applyLoss(70, 5), 65);
  });
});

describe("partial exit and runner", () => {
  it("partial exit at +20% ROI", () => {
    const cfg = getPortfolioConfig();
    const up = updateSimulatedPosition(
      0.5,
      0.62,
      10,
      1,
      0,
      false,
      false,
      "YES",
      {
        currentPrice: 0.62,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
      cfg,
    );
    assert.equal(up.partialExitDone, true);
    assert.equal(up.runnerActive, true);
    assert.ok(up.positionRemaining <= 0.16);
  });

  it("runner exits at +50%", () => {
    const cfg = getPortfolioConfig();
    const up = updateSimulatedPosition(
      0.4,
      0.65,
      10,
      0.15,
      2,
      true,
      true,
      "YES",
      {
        currentPrice: 0.65,
        outcomeSide: "YES",
        signalExpired: false,
        signalInactive: false,
        marketClosed: false,
        consensusCollapsed: false,
      },
      cfg,
    );
    assert.equal(up.closed, true);
  });
});

describe("reallocation logic", () => {
  it("recommends REALLOCATE when cap full and score gap met", () => {
    const cfg = getPortfolioConfig();
    const deployed = 70 * cfg.maxDeployedPct;
    const result = evaluateSignalAllocation(
      baseSignal({
        marketId: "m-new",
        alphaScore: 98,
        consensusScore: 95,
        systemConfidenceScore: 90,
        marketQualityScore: 88,
      }),
      baseCtx({
        deployedCapital: deployed,
        openPositions: [
          {
            id: "p1",
            signalId: "old",
            marketId: "m-old",
            category: "politics",
            compositeScore: 78,
            allocatedUsd: deployed,
            positionPct: cfg.maxDeployedPct,
          },
        ],
      }),
    );
    assert.equal(result.decision, "REALLOCATE");
    assert.ok(result.reallocationTargetId === "p1");
  });
});

describe("risk score", () => {
  it("increases with weak inputs", () => {
    const low = computeRiskScore(
      baseSignal({ liquidityScore: 20, systemConfidenceScore: 30, sparseData: true }),
      new Set(),
      0,
      0.4,
    );
    const high = computeRiskScore(baseSignal(), new Set(), 0, 0.4);
    assert.ok(low > high);
  });
});

describe("no execution", () => {
  it("execution flag stays disabled", () => {
    assert.equal(EXECUTION_DISABLED, true);
  });
});

describe("allocation accept", () => {
  it("accepts strong TRADE_NOW with room", () => {
    const r = evaluateSignalAllocation(baseSignal(), baseCtx());
    assert.equal(r.decision, "ACCEPT");
    assert.ok(r.recommendedSizeUsd > 0);
    assert.ok(!wouldExceedDeployedCap(0, r.recommendedSizeUsd, 70, getPortfolioConfig()) || r.capViolation);
  });
});
