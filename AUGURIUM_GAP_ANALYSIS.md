# AUGURIUM — Architecture Audit & Gap Analysis

**Audit date:** 2026-06-02 (updated after Phase B)  
**Repository:** [RyanTallent/AUGURIUM](https://github.com/RyanTallent/AUGURIUM)  
**Scope:** Full codebase review against the three original platform goals  

---

## Phase status (A–G)

| Phase | Status | Verification |
|-------|--------|----------------|
| **A** — Ingestion | **Complete** | `node scripts/verify-phase-a.mjs` |
| **B** — Trader metrics + copyability | **Complete** | `npm run verify:phase-b` |
| **C** — Consensus / signals | **Complete** | `npm run verify:phase-c` |
| **D** — Shadow + simulation + replay | **Complete** | `npm run verify:phase-d` |
| **E** — Discord + weekly reports | **Complete** | `npm run verify:phase-e` |
| **F** — Portfolio, risk, allocation | **Complete** | `npm run verify:phase-f` |
| **G** — Execution providers + safeguards | **Complete** | `npm run verify:phase-g` |

### Phase C deliverables (implemented)

- `@augurium/intelligence` — consensus, market quality, alpha, system confidence, watchlist classification, reasoning
- Extended `Signal` model with full Phase C fields; `Market` cache fields for dashboard
- Worker `generate-signals` job on `signal:generate` queue
- Dashboard: `/overview`, `/markets`, `/signals`
- Tests: `npm run test:intelligence` · verify: `npm run verify:phase-c`

### Phase D deliverables (implemented)

- `@augurium/shadow` — entry delays (30s/3m/10m), Augurium partial exit (+20% / 85%+15% runner), MFE/MAE, missed profit
- Models: `ShadowTrade`, `SimulationResult`, `ReplaySnapshot`
- Worker `shadow-portfolio` on `shadow:sync` queue
- Dashboard: `/shadow`, `/simulations`, `/replay`
- Tests: `npm run test:shadow` · verify: `npm run verify:phase-d`

### Phase G deliverables (implemented)

- `@augurium/execution` — `ExecutionProvider` interface, Paper/Polymarket/Replay providers, safety gates, idempotency locks, exit engine, secret redaction
- Models: `ExecutionOrder`, `ExecutionFill`, `ExecutionPosition`, `ExecutionLock`, `ExecutionAuditLog`, `ExecutionReconciliation`
- Worker `execution-engine` on `execution:run` queue (disabled unless `EXECUTION_ENABLED=true`)
- Polymarket provider: **NOT_READY** (explicit errors; no fake fills)
- Dashboard: `/execution`
- Tests: `npm run test:execution` · verify: `npm run verify:phase-g` · paper E2E: `npm run paper:e2e`

### Phase F deliverables (implemented)

- `@augurium/portfolio` — composite scoring, tiered sizing, risk score, drawdown mode, capital ledger (60/40 profit split), reallocation logic, simulated profit rules (+20% / runner)
- Models: `PortfolioState`, `PortfolioPosition`, `PortfolioDecision`, `PortfolioAllocationSnapshot`, `RiskEvent`, `CapitalLedgerEntry`
- Worker `portfolio-engine` on `portfolio:run` queue
- Discord: advisory `PORTFOLIO_DECISION`, `PORTFOLIO_RISK`, `PORTFOLIO_REALLOCATE` (no live trade alerts)
- Dashboard: `/portfolio`, `/risk`, `/allocations`
- Tests: `npm run test:portfolio` · verify: `npm run verify:phase-f`

### Phase E deliverables (implemented)

- `@augurium/discord` — rich embeds, webhook dispatch, retry backoff, dedupe keys
- Model: `DiscordEvent` (PENDING/SENT/SKIPPED/FAILED)
- Worker: `discord:enqueue`, `discord:dispatch` queues
- Alert types: signals, shadow, trader novelty, risk/system, weekly intelligence report
- Dashboard: `/reports`
- Tests: `npm run test:discord` · verify: `npm run verify:phase-e`

### Phase B deliverables (implemented)

- `@augurium/scoring` package: ROI, win rate, profit factor, confidence, copyability (30s/3m/10m delays), information edge, category metrics, ranking (copyability-weighted), tiers (`PROSPECT` → `SUPER_ELITE`)
- Prisma: `TraderMetricsSnapshot`, `TraderCategoryMetric`, `TraderScoreHistory`, `TraderTierHistory`
- Worker job: `score-traders` on `QUEUES.TRADER_SCORE` (no signals, no execution)
- Dashboard: `/traders`, `/traders/[wallet]`
- Tests: `npm run test:scoring`

---

## Executive Summary

AUGURIUM has **real Phase A–G** on live Polymarket data through simulated portfolio and **execution infrastructure**. **Live Polymarket trading remains disabled by default** (`EXECUTION_ENABLED=false`, Polymarket provider NOT_READY).

| Pillar | Estimated completion | Verdict |
|--------|---------------------|---------|
| **1. Foundation Architecture** | ~50% | Monorepo, DB schema, Docker, CI; migrations/production deploy still thin |
| **2. Intelligence Engine** | ~55% | Ingestion, scoring, copyability, consensus signals; clustering still absent |
| **3. Execution Layer** | ~45% | Shadow/sim/replay + simulated portfolio engine; live execution still disabled |

**Highest-risk gaps:** TRADE_NOW signals still rare (thin consensus); live execution not wired; Redis/DB health checks basic; Discord requires explicit env enablement.

---

## Reference: Original Platform Goals

Derived from `README.md`, `apps/web/src/app/page.tsx` (Platform modules), and `packages/shared` / Prisma schema.

| Goal area | Intended capabilities |
|-----------|----------------------|
| **Foundation** | Monorepo, Postgres + Prisma, Redis job queues, Next.js dashboard, worker processes, Docker dev stack, CI/CD, deployability |
| **Intelligence** | Market ingestion (Polymarket), trader ingestion & scoring, clustering, signal generation, risk-adjusted alpha, ingestion observability |
| **Execution** | Portfolio management, allocation engine, position tracking, simulation & replay, Discord notifications, optional trade execution hooks |

---

## 1. Foundation Architecture

### Completed features

| Item | Location / evidence |
|------|-------------------|
| npm workspaces monorepo | Root `package.json` — `apps/*`, `packages/*` |
| Shared constants & queue names | `packages/shared/src/index.ts` — `QUEUES`, `APP_NAME` |
| PostgreSQL data model (6 domain models) | `packages/database/prisma/schema.prisma` |
| Prisma client singleton (dev hot-reload safe) | `packages/database/src/index.ts` |
| Local infra: Postgres 16 + Redis 7 | `docker-compose.yml` |
| Environment template | `.env.example` — `DATABASE_URL`, `REDIS_URL`, `DISCORD_WEBHOOK_URL`, `POLYMARKET_API_BASE` |
| Next.js 15 web app (App Router) | `apps/web/` |
| Node worker with Redis polling | `apps/worker/src/index.ts` |
| Git ignore for secrets | `.gitignore` — `.env` (verified not tracked) |
| GitHub Actions CI (partial) | `.github/workflows/ci.yml` |
| GitHub setup script | `scripts/setup-github.ps1` |
| Documentation & quick start | `README.md` |

### Partially completed features

| Item | What exists | What’s missing |
|------|-------------|----------------|
| **Redis job system** | List queues (`LPOP`), bootstrap `RPUSH` on startup, 30s poll loop | No job payload schema, retries, dead-letter, scheduling, or producers after bootstrap |
| **CI pipeline** | Builds `@augurium/shared`, generates Prisma client, builds `@augurium/web` | Does not build/start `@augurium/worker`; no DB integration tests; no lint step |
| **Database workflow** | `db:generate`, `db:push` scripts | No committed Prisma migrations; production migration story undefined |
| **Web ↔ data access** | Server Component reads stats via Prisma | No API routes, no BFF, no caching layer; dashboard only |
| **Ingestion observability** | `IngestionRun` model + UI “Last ingestion” | Only used for market ingest; no metrics/tracing/alerting |
| **Type sharing** | `TraderScore`, `TradingSignal`, `PortfolioAllocation` interfaces | Not imported anywhere outside `shared` package |

### Missing features

| Item | Priority (see backlog) |
|------|------------------------|
| Prisma migration history & deploy strategy | Critical |
| Production deployment config (`render.yaml`, Dockerfile, or equivalent) | High |
| Worker included in CI build/test | High |
| Health check endpoints (web + worker + DB + Redis) | High |
| Structured logging & correlation IDs | Medium |
| API layer (`app/api` or dedicated service) decoupling web from DB | High |
| Secrets management (not hardcoded dev credentials in compose) | High |
| Rate limiting / backoff for external APIs | Medium |
| Observability (metrics, APM, error tracking) | Medium |
| Automated test suite (unit + integration) | Critical |
| Multi-environment config (dev/staging/prod) | Medium |
| Horizontal scaling story for worker(s) | Medium |

### Placeholder implementations

| Item | Notes |
|------|-------|
| `QUEUES.DISCORD_NOTIFY` | Defined in shared; worker explicitly skips processing |
| Platform module list on dashboard | Marketing/roadmap list, not feature flags or status |

### Mock implementations

None in Foundation layer (mock logic lives in Intelligence).

### Unused code

| Item | Notes |
|------|-------|
| `QUEUES.DISCORD_NOTIFY` | Never processed |
| `DISCORD_WEBHOOK_URL` in `.env.example` | Never read in application code |
| `TraderScore`, `TradingSignal`, `PortfolioAllocation` types | Exported but unused |
| `packages/database` `migrate` script | No migrations directory in repo |
| `category` on `Market` model | Never set during ingest |

### Architectural risks (Foundation)

| Risk | Severity | Detail |
|------|----------|--------|
| **Web app talks directly to Prisma** | High | No API boundary; harder to scale, authorize, and version contracts |
| **`db push` without migrations** | High | Schema drift across environments; unsafe for production |
| **Single-process worker poll loop** | Medium | No concurrency control, no distributed locking; duplicate workers could double-process |
| **Redis queues are fire-and-forget strings** | Medium | Payload `"bootstrap"` ignored; no job IDs or ack semantics |
| **CI does not validate worker** | Medium | Worker TypeScript/build regressions can ship unnoticed |
| **No graceful degradation contract** | Low | Web swallows DB errors (returns zeros); masks partial outages |

### Security risks (Foundation)

| Risk | Severity | Detail |
|------|----------|--------|
| **Default Docker credentials** | High | `augurium:augurium` in `docker-compose.yml` — fine for local dev, must not reach production |
| **No authentication/authorization** | Critical | Dashboard and future APIs are open if deployed |
| **No input validation layer** | Medium | No API routes yet; risk grows when added |
| **Prisma in Next.js server** | Medium | SQL injection mitigated by Prisma; still need query authorization per user/tenant |
| **No TLS/redis AUTH in compose** | Medium | Acceptable locally; required for cloud Redis |
| **Dependency supply chain** | Low | No lockfile audit or Dependabot config observed |

### Scalability risks (Foundation)

| Risk | Severity | Detail |
|------|----------|--------|
| **Dashboard `force-dynamic` + DB on every request** | Medium | No caching; will not scale with traffic |
| **Worker sequential queue drain per tick** | Medium | Throughput capped; no parallel job workers |
| **Postgres single instance** | Medium | No read replicas, partitioning, or archival strategy |
| **No connection pooling config** | Low | Prisma default pool may be insufficient at scale |

---

## 2. Intelligence Engine

### Completed features

| Item | Location / evidence |
|------|-------------------|
| Polymarket market ingestion (live HTTP) | `apps/worker/src/jobs/ingest-markets.ts` — `gamma-api.polymarket.com/events` |
| Market upsert by `externalId` | Prisma `market.upsert` |
| Ingestion run logging (success/failure) | `IngestionRun` create/update |
| Worker orchestration hooks | `index.ts` — queues for ingest, score, signal |
| Data models for traders, positions, signals | `schema.prisma` |

### Partially completed features

| Item | What exists | What’s missing |
|------|-------------|----------------|
| **Market ingestion** | Fetches 20 active events, maps id/title/slug/endDate/active | Pagination, markets vs events, prices/volume, categories, historical backfill, idempotency keys, retry policy |
| **Trader scoring** | **Phase B complete** — `@augurium/scoring`, snapshots, copyability, tiers | No cluster analysis; categories often uncategorized; rescoring schedule not cron’d |
| **Signal generation** | Creates DB rows for top 5 markets | Random confidence, fixed YES side, static rationale; not tied to market/trader data |
| **Intelligence pipeline** | Bootstraps all jobs on worker start | No dependency order (e.g. ingest → score → signal); no staleness checks |

### Missing features

| Item | Priority |
|------|----------|
| Trader ingestion from Polymarket (or other sources) | Critical |
| Position ingestion / trade history sync | Critical |
| Real scoring model (ROI, win rate, sample size, time decay) | Critical |
| Trader clustering / cohort analysis | High |
| Signal engine using market + trader + position data | Critical |
| Signal lifecycle (expire, supersede, audit trail) | High |
| Risk-adjusted metrics (Sharpe, drawdown) on traders/signals | High |
| Category/tag enrichment for markets | Medium |
| Multiple market sources beyond Polymarket | Medium |
| Backtesting / simulation engine (listed on dashboard) | High |
| Feature store or computed metrics tables | Medium |
| ML / statistical models (if in original vision) | Low–Medium |

### Placeholder implementations

| File | Behavior |
|------|----------|
| `apps/worker/src/engines/signals.ts` | Still disabled — Phase C only |
| `apps/worker/src/engines/signals.ts` | Comment: *"Placeholder signal engine — generates demo signals for top markets."* Fixed rationale string; `Math.random()` for confidence |

### Mock implementations

| Item | Detail |
|------|--------|
| **Signal confidence** | `0.55 + Math.random() * 0.2` — non-deterministic, not reproducible |
| **Signal side** | Always `"YES"` |
| **Signal rationale** | Static placeholder text |
| **Dashboard copy** | "Scored & clustered", "Risk-adjusted alpha" — **not backed by implementation** |

### Unused code (Intelligence)

| Item | Notes |
|------|-------|
| `Position` model | No reads/writes in worker or web |
| `Trader` model | No ingestion; scoring no-ops on empty DB |
| `Market.category` | Schema field never populated |
| `Trader.label` | Never set |
| `Signal.status` | Only queried as `"active"`; no inactive/expired flow |
| Shared `TraderScore` / `TradingSignal` types | Unused in engines |

### Architectural risks (Intelligence)

| Risk | Severity | Detail |
|------|----------|--------|
| **Placeholder signals look like real product data** | Critical | Misleading UX and downstream decisions if deployed |
| **No trader/position ingest** | Critical | Intelligence pipeline is hollow; scores/signals are meaningless |
| **Randomness in signals** | High | Non-testable, non-auditable; violates reproducibility |
| **Polymarket API coupling without abstraction** | Medium | Hard to swap sources or mock in tests |
| **No data quality checks** | Medium | Bad API responses could corrupt DB silently |
| **20-event limit** | Medium | Incomplete market universe |

### Security risks (Intelligence)

| Risk | Severity | Detail |
|------|----------|--------|
| **Unvalidated external API JSON** | Medium | Type assertion only (`as PolymarketEvent[]`); malformed data could cause runtime errors |
| **No API key / auth for Polymarket** | Low | Public gamma API today; may change |
| **Signal rationale stored as free text** | Low | XSS risk if rendered in web without sanitization (not applicable yet) |

### Scalability risks (Intelligence)

| Risk | Severity | Detail |
|------|----------|--------|
| **Per-trader sequential Prisma updates in scoring** | Medium | N+1 updates; slow at thousands of traders |
| **No batching or bulk upsert for markets** | Medium | 20 items fine; thousands will bottleneck |
| **No incremental sync / cursors** | High | Full snapshot mindset; won’t scale to full Polymarket catalog |
| **No separate analytics DB** | Low | OLTP Postgres used for everything |

---

## 3. Execution Layer

### Completed features

| Item | Notes |
|------|-------|
| `PortfolioSnapshot` schema | Fields: `totalValue`, `allocations` (JSON), `sharpeRatio`, `maxDrawdown`, `capturedAt` |
| `Position` schema | Links trader ↔ market with side, size, prices, PnL |
| `PortfolioAllocation` interface | `packages/shared` — type only |
| Queue name for notifications | `discord:notify` (skipped in worker) |

### Partially completed features

None with working execution logic.

### Missing features

| Item | Priority |
|------|----------|
| Portfolio allocation engine | Critical |
| Portfolio snapshot writer / history | High |
| Position sync from chain/API | Critical |
| PnL calculation and reconciliation | High |
| Risk limits / max exposure enforcement | Critical |
| Simulation engine | High |
| Replay / backtest runner | High |
| Discord notification worker | Medium |
| Trade execution / order placement (if in scope) | High (if live trading) / Low (if read-only intel) |
| Wallet / key management | Critical (if execution) |
| Paper trading mode | Medium |
| Web UI for portfolio & positions | High |
| Audit log for allocation changes | Medium |

### Placeholder implementations

| Item | Notes |
|------|-------|
| Dashboard bullets | "Portfolio management", "Simulation & replay engines", "Discord notifications" — UI only |
| `DISCORD_NOTIFY` queue | Skipped in `apps/worker/src/index.ts` |

### Mock implementations

| Item | Notes |
|------|-------|
| Intelligence placeholders indirectly affect execution | Signals would drive allocations once built — currently unsafe to wire |

### Unused code (Execution)

| Model / constant | Notes |
|------------------|-------|
| `PortfolioSnapshot` | Zero application references |
| `Position` | Zero application references |
| `PortfolioAllocation` type | Zero imports |
| `DISCORD_WEBHOOK_URL` | Env only |

### Architectural risks (Execution)

| Risk | Severity | Detail |
|------|----------|--------|
| **No separation between intel and execution** | High | Future risk: placeholder signals could trigger real trades |
| **JSON allocations without schema validation** | Medium | `PortfolioSnapshot.allocations` is untyped JSON |
| **No idempotency for trades/allocations** | High | Required before any real execution |
| **No compliance / kill switch** | High | Required for automated trading |

### Security risks (Execution)

| Risk | Severity | Detail |
|------|----------|--------|
| **Discord webhook URL in env** | Medium | Leak = spam channel; needs rotation story |
| **Future wallet keys in env** | Critical | Must use secret manager, never commit |
| **No RBAC for portfolio changes** | Critical | When UI/API exist |

### Scalability risks (Execution)

| Risk | Severity | Detail |
|------|----------|--------|
| **Snapshot table unbounded growth** | Medium | Needs retention/TTL policy |
| **Synchronous allocation in worker** | Medium | May need event-driven architecture |

---

## Cross-Cutting Findings

### Repository inventory

| Category | Count |
|----------|-------|
| Applications | 2 (`web`, `worker`) |
| Packages | 2 (`database`, `shared`) |
| Prisma models | 6 (`Market`, `Trader`, `Position`, `Signal`, `PortfolioSnapshot`, `IngestionRun`) |
| Worker jobs | 1 (`ingest-markets`) |
| Worker engines | 2 (`scoring`, `signals` — both placeholders) |
| Web pages | 1 (`page.tsx`) |
| API routes | 0 |
| Tests | 0 |
| Dockerfiles | 0 |
| `render.yaml` | 0 |

### Data flow (as implemented today)

```
Polymarket API ──fetch──► ingest-markets.ts ──► Market (+ IngestionRun)
                              │
                              ▼
                    [Trader table empty]
                              │
         scoreTraders() ◄─────┘ (no-op / trivial if empty)
         generateSignals() ──► Signal (randomized placeholder)
                              │
                              ▼
              Next.js page.tsx ──► dashboard counts
```

### Misleading product surface

The dashboard and README claim capabilities that are **not implemented**:

- "Scored & clustered" — no clustering code
- "Risk-adjusted alpha" — no risk model on signals
- Platform modules list — 4 of 6 modules have no code paths

---

## Ranked Gap Backlog

All missing and incomplete items consolidated and ranked.

### Critical

| # | Gap | Pillar | Rationale |
|---|-----|--------|-----------|
| C1 | Trader ingestion pipeline | Intelligence | Without traders, scoring and intel are empty |
| C2 | Position / trade history ingestion | Intelligence / Execution | `Position` model unused; required for ROI/PnL truth |
| C3 | Replace placeholder signal engine with data-driven logic | Intelligence | Random signals are unsafe for a real product |
| C4 | Replace placeholder scoring with real metrics + sample size | Intelligence | Current formula on stale/empty data is meaningless |
| C5 | Authentication & authorization | Foundation | Any public deploy exposes DB-backed dashboard |
| C6 | Automated tests (ingest, scoring, signals, web) | Foundation | Zero coverage; regressions guaranteed |
| C7 | Prisma migrations (replace ad-hoc `db push` for prod) | Foundation | Production schema safety |
| C8 | Guardrail: intel must not drive execution until validated | Execution | Prevents accidental live trading on mock signals |

### High

| # | Gap | Pillar | Rationale |
|---|-----|--------|-----------|
| H1 | API layer between web and database | Foundation | Security, versioning, caching |
| H2 | Worker build & test in CI | Foundation | Worker is core pipeline |
| H3 | Production deployment artifacts | Foundation | Render/Docker/K8s readiness |
| H4 | Market ingestion: pagination, full catalog, prices/volume | Intelligence | 20 events is not a platform |
| H5 | Signal lifecycle (expire, supersede, audit) | Intelligence | Operational necessity |
| H6 | Portfolio allocation engine + snapshot writer | Execution | Core execution-layer value prop |
| H7 | Web UI: markets list, traders, signals (not just counts) | Foundation / Intel | Product unusable for analysis |
| H8 | Trader clustering / cohort analysis | Intelligence | Advertised on dashboard |
| H9 | Risk limits & max exposure on allocations | Execution | Required before real capital |
| H10 | Secrets & env hardening for production | Foundation | Default compose passwords |
| H11 | Simulation / backtest engine | Intelligence / Execution | Listed as platform module |
| H12 | Health checks & structured logging | Foundation | Operability |

### Medium

| # | Gap | Pillar | Rationale |
|---|-----|--------|-----------|
| M1 | Discord notification worker | Execution | Queue exists; env defined |
| M2 | Redis job reliability (retries, DLQ, payload schema) | Foundation | Fragile queue semantics |
| M3 | Rate limiting / backoff on Polymarket fetches | Foundation / Intel | API stability |
| M4 | Observability (metrics, tracing, Sentry) | Foundation | Debug production issues |
| M5 | Caching layer for dashboard | Foundation | Scale read path |
| M6 | `Market.category` enrichment | Intelligence | Schema ready, unused |
| M7 | Use shared types in engines & web | Foundation | Reduce drift |
| M8 | Multi-environment configuration | Foundation | staging/prod parity |
| M9 | Horizontal worker scaling / locking | Foundation | Duplicate processing risk |
| M10 | Portfolio history retention policy | Execution | Snapshot growth |
| M11 | Lint + typecheck gate in CI | Foundation | Quality bar |
| M12 | Data quality validation on ingest | Intelligence | Corrupt rows |

### Low

| # | Gap | Pillar | Rationale |
|---|-----|--------|-----------|
| L1 | Additional market sources (beyond Polymarket) | Intelligence | Expansion, not MVP |
| L2 | ML / advanced statistical models | Intelligence | Future enhancement |
| L3 | `render.yaml` / platform-specific IaC | Foundation | When deploy target chosen |
| L4 | Dependabot / npm audit automation | Foundation | Supply chain hygiene |
| L5 | Paper trading mode | Execution | Nice before live |
| L6 | Feature flags for module rollout | Foundation | DX improvement |
| L7 | Archive / partition old `IngestionRun` rows | Foundation | Long-term ops |

---

## Recommended Build Order (Post-Audit)

Not code — sequencing guidance only:

1. **Foundation hardening:** migrations, tests, CI worker build, API skeleton, auth stub  
2. **Data truth:** trader + position ingestion, improved market ingest  
3. **Real intelligence:** scoring → clustering → signals (remove randomness)  
4. **Product surface:** markets/traders/signals pages  
5. **Execution:** portfolio snapshots → allocation rules → Discord → simulation  
6. **Production:** deploy config, secrets, observability, health checks  

---

## Appendix: File-to-Feature Matrix

| File | Role | Status |
|------|------|--------|
| `apps/worker/src/jobs/ingest-markets.ts` | Market ingestion | **Partial** — live API, limited fields |
| `apps/worker/src/jobs/score-traders.ts` | Trader scoring | **Real (Phase B)** |
| `packages/scoring/` | Metrics + copyability + ranking | **Real (Phase B)** |
| `apps/worker/src/engines/signals.ts` | Signal generation | **Disabled (Phase C)** |
| `apps/worker/src/engines/signals.ts` | Signal generation | **Placeholder / mock** |
| `apps/worker/src/index.ts` | Queue worker | **Partial** — skips Discord |
| `apps/web/src/app/page.tsx` | Dashboard | **Partial** — stats only |
| `packages/database/prisma/schema.prisma` | Data model | **Complete** schema, **partial** usage |
| `packages/shared/src/index.ts` | Types & queues | **Partial** — unused exports |
| `.github/workflows/ci.yml` | CI | **Partial** — web only |
| `docker-compose.yml` | Local infra | **Complete** for dev |
| `scripts/setup-github.ps1` | DevOps helper | **Complete** |

---

*End of audit. No application code was changed during this review.*
