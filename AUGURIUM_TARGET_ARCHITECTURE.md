# AUGURIUM — Target Architecture (Locked)

**Status:** Authoritative system definition  
**Audience:** Single-user, production-grade prediction-market intelligence + autonomous trading  
**Principle:** Do not treat placeholders as product features. No random scoring. No mock signals. No live execution until ingestion, scoring, risk, and reconciliation are real.

---

## System Identity

AUGURIUM is **not** a Polymarket dashboard. It is an end-to-end platform that:

1. Ingests and stores market and wallet truth from Polymarket
2. Builds trader, cluster, and consensus intelligence
3. Sizes and manages a portfolio under hard risk rules
4. Learns from live, shadow, and simulated outcomes
5. Executes only through a guarded `ExecutionProvider` abstraction

---

## Implementation Phases (Ordered)

| Phase | Scope | Gate |
|-------|--------|------|
| **A** | Trader + trade + position ingestion | **Complete** |
| **B** | Real trader scoring + copyability | **Complete** (verify: `npm run verify:phase-b`) |
| **C** | Consensus, alpha, confidence, watchlist | **Complete** (`npm run verify:phase-c`) |
| **D** | Shadow portfolio, simulation, replay | **Complete** (`npm run verify:phase-d`) |
| **E** | Discord alerts + weekly reports | **Complete** (`npm run verify:phase-e`) |
| **F** | Portfolio, risk, profit engines | **Complete** (`npm run verify:phase-f`) |
| **G** | Execution providers + live trading safeguards | **Complete** (`npm run verify:phase-g`) — live CLOB still NOT_READY |

---

## Layer 1 — Foundation Architecture

| Requirement | Target |
|-------------|--------|
| Monorepo | TypeScript npm workspaces: `apps/web`, `apps/worker`, `packages/*` |
| Dashboard | Next.js App Router, server components, eventual API boundary |
| Database | PostgreSQL + Prisma, migrations for production |
| Events | Redis lists/streams for job orchestration |
| Workers | Dedicated Node process(es), horizontally scalable later |
| Deploy | Docker Compose (dev), Render (prod), no secrets in git |
| CI | GitHub Actions: install, generate, build all workspaces, test |
| Security | `.env` gitignored, secret manager in prod, auth before public deploy |

---

## Layer 2 — Polymarket Data Ingestion

| Stream | Source (public) | Storage |
|--------|-----------------|---------|
| Markets / events | Gamma API | `Market`, raw payloads |
| Global trades | Data API `/trades` | `Trade`, wallet discovery |
| Wallet activity | Data API `/activity?user=` | `Trade` / activity rows, backfill |
| Wallet positions | Data API `/positions?user=` | `Position` (API truth) |
| Market holders | Data API `/holders?market=` | `Trader` discovery |

**Cross-cutting ingestion requirements:**

- Cursor pagination (`offset` / timestamp) via `SyncCursor`
- Deduplication (`externalKey` on trades)
- Raw API payload retention (`RawApiPayload`)
- Resumable sync state per stream
- Historical backfill per wallet (activity cursor)
- No mock or synthetic market data

---

## Layer 3 — Trader Intelligence (Phase B+)

- Track all detectable wallets
- Reconstruct positions from trades (validated against API positions)
- Metrics: ROI, copied ROI, win rate, volume, trade count, hold time, drawdown
- Classify: consistent profitable, emerging, category specialists

---

## Layer 4 — Copyability Engine (Phase B+)

- Rank by copy-profitability, not raw ROI alone
- Track slippage, delay, copied ROI, mirrorability

---

## Layer 5 — Cluster Intelligence (Phase B/C+)

- Detect wallets trading together
- Score clusters: profitability, copyability, timing, category, conviction

---

## Layer 6 — Leader / Follower Engine (Phase C+)

- Entry order detection, follow latency, influence scoring

---

## Layer 7 — Consensus Engine (Phase C+)

Weighted consensus from:

- Trader quality, category expertise, conviction, information edge, cluster strength, copyability

Signal categories: **Trade Now**, **Watchlist**, **Research**, **Ignore**

---

## Layer 8 — Alpha + Confidence (Phase C+)

| Score | Purpose |
|-------|---------|
| **Alpha Score** | Current edge quality |
| **System Confidence** | Trust in system state |

Both feed position sizing (Phase F). Never use random values.

---

## Layer 9 — Portfolio Engine (Phase F)

| Rule | Value |
|------|-------|
| Max deployed capital | 80% |
| Preferred positions | 2–5 |
| Sizing by score | 95+ → 10%, 90–94 → 8%, 85–89 → 6%, 80–84 → 4%, &lt;80 → no trade |
| Reallocation | Move capital from weaker to stronger opportunities |

---

## Layer 10 — Risk Engine (Phase F)

| Rule | Value |
|------|-------|
| Max normal position | 15% |
| Exceptional signal | 20% |
| Absolute hard cap | 25% |
| Drawdown brake | 10% drawdown → 50% sizing reduction |
| Execution guard | **Never** execute on placeholder/mock signals |

Hard risk rules are **not** auto-modified by the learning engine.

---

## Layer 11 — Profit Management (Phase F)

- At +20% profit: sell 85%, keep 15% runner
- Runner exit: +50%, trader exit, consensus collapse, or better opportunity
- Reinvest 60% / reserve 40%

---

## Layer 12 — Shadow Portfolio (Phase D)

- Track skipped/rejected trades and counterfactual PnL
- Feed weekly learning

---

## Layer 13 — Simulation Engine (Phase D)

- Alternative exits, sizing, slippage, consensus thresholds, hold-until-trader-exit

---

## Layer 14 — Replay Engine (Phase D)

Immutable decision snapshots:

- Market, trader, cluster, portfolio state
- Entry and exit rationale

---

## Layer 15 — Discord Intelligence (Phase E)

- Rich alerts: entries, exits, risk, trader events, weekly reports
- Every alert explains **why** the system acted

---

## Layer 16 — Weekly Learning Engine (Phase E+)

Every 7 days: review live, shadow, simulation, trader/cluster/category performance.

- Allow **small bounded** weight adjustments
- **Never** modify hard risk rules automatically

---

## Layer 17 — Novelty / Research Engine (Phase C+/G)

- Continuous search for new traders, clusters, categories, strategies
- Tiny exploratory trades only after confidence + risk scoring

---

## Layer 18 — Execution Layer (Phase G)

```text
ExecutionProvider (interface)
├── PaperExecutionProvider
├── PolymarketExecutionProvider
└── ReplayExecutionProvider
```

**Live execution prerequisites:**

- Real trader ingestion + position reconstruction
- Real scoring + consensus + risk checks
- Portfolio reconciliation
- Duplicate-order prevention
- Explicit operator enable flag

---

## Data Flow (Target State)

```text
Polymarket APIs
    → Ingestion (raw + normalized + cursors)
    → Trader Intelligence
    → Copyability + Clusters + Leader/Follower
    → Consensus + Alpha + Confidence
    → Portfolio + Risk + Profit
    → ExecutionProvider (paper → live)
    ↓
Shadow / Simulation / Replay / Discord / Weekly Learning
```

---

## Current State vs Target (Honest)

| Area | Today | Target |
|------|-------|--------|
| Ingestion | Markets only (partial) | Full streams + cursors + raw store |
| Intelligence | Placeholder scoring/signals | Deterministic, data-driven |
| Execution | Schema only | Provider abstraction + safeguards |
| Product UI | Stat cards | Full operational dashboard |

See `AUGURIUM_GAP_ANALYSIS.md` for audit detail.

---

## Non-Negotiables

1. No random or mock signal generation in production paths
2. No live trading until Phase G gates pass
3. Do not claim features on the dashboard that are not implemented
4. All ingestion must be resumable and auditable (raw payloads + cursors)
5. Hard risk caps are human-approved only

---

*Architecture locked. Implementation follows phased plan above.*
