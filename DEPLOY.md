# AUGURIUM — Render deployment

Production URLs:

- Web: https://augurium-web.onrender.com
- Worker: background service (ingestion, scoring, signals, shadow)

## Render Environment Group (`augurium-shared`)

Set these in the Render dashboard for **both** web and worker (never commit secrets):

| Variable | Example | Notes |
|----------|---------|--------|
| `DISCORD_ENABLED` | `true` | Must be literal `true` for alerts to send |
| `DISCORD_WEBHOOK_URL` | *(secret)* | Discord channel webhook — sync: false |
| `AUGURIUM_DASHBOARD_URL` | `https://augurium-web.onrender.com` | Used in embed links |
| `EXECUTION_ENABLED` | `false` | Keep off until paper/live review |
| `LIVE_TRADING_ENABLED` | `false` | Must stay false in production |
| `ALLOW_REAL_MONEY` | `false` | Must stay false |

Optional tuning:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIGNAL_WINDOW_MINUTES` | `1440` | Recent activity window for signals (24h) |
| `SCORE_TRADERS_BATCH_SIZE` | `250` | Wallets scored per worker run |
| `WORKER_INTERVAL_TRADER_SCORE_MS` | `30000` | score-traders interval |
| `WORKER_INTERVAL_SHADOW_SYNC_MS` | `30000` | shadow:sync interval |
| `SCORE_RESCORE_COOLDOWN_HOURS` | `24` | Min hours before rescore (active wallets) |
| `SCORE_LOW_VALUE_RESCORE_HOURS` | `72` | Min hours before rescore (low trade count) |
| `SHADOW_SYNC_BATCH_SIZE` | `250` | Shadow trades repriced per run (open + closed, stale first). Do **not** set legacy `SHADOW_MAX_UPDATE=1` — it is ignored but was capping the fleet to 1. |
| `SHADOW_SYNC_CHUNK_SIZE` | `25` | Shadows processed per chunk (progress written after each) |
| `SHADOW_SYNC_MAX_RUNTIME_MS` | `180000` | Hard cap; partial timeout (processed > 0) records success with metadata |
| `SHADOW_PRICE_STALE_MS` | `21600000` (6h) | Trade age after which price is STALE (real tape only) |

After changing env vars, **redeploy the worker** (and web if dashboard Discord status should reflect new values).

## Web memory & database pool (Render Starter 512MB)

The dashboard reads **precomputed snapshots** refreshed by the worker (`web:snapshot-refresh`, default every 3 minutes). Do not rely on the web process running full analytics on each page load.

**Web service only:**

| Variable | Recommended | Purpose |
|----------|-------------|---------|
| `AUGURIUM_SERVICE` | `web` | Enables low Prisma `connection_limit` |
| `WEB_PRISMA_CONNECTION_LIMIT` | `5` | Web Prisma pool cap (avoid exhausting Postgres) |
| `WEB_HEALTH_DB_TIMEOUT_MS` | `20000` | `/api/health/deep` DB timeout |
| `WEB_MAX_CONCURRENT_QUERIES` | `2` | Limits parallel heavy fallbacks |
| `WEB_SNAPSHOT_STALE_MS` | `600000` | Treat snapshots older than 10m as stale |
| `NODE_OPTIONS` | `--max-old-space-size=460` | Headroom under 512MB plan |

**Worker:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKER_INTERVAL_WEB_SNAPSHOT_REFRESH_MS` | `180000` | Snapshot refresh interval (1–5 min) |
| `AUGURIUM_SERVICE` | `worker` | Enables worker Prisma `connection_limit` |
| `WORKER_PRISMA_CONNECTION_LIMIT` | `8` | Worker pool cap (web + worker share one Postgres) |

Health check URL: `/api/health` (instant 200, no database — required for Render deploy liveness). Deep diagnostics: `/api/health/deep`.

Optional: schedule a **daily web restart** off-peak in Render if heap still drifts — this is a safety valve, not the primary fix.

## Post-deploy maintenance

```bash
npm run db:push          # apply schema
npm run db:generate
npm run maintenance:production -- --dry-run   # diagnose only (no writes)
npm run maintenance:production              # repair + verify + report
```

Report written to `PRODUCTION_MAINTENANCE_REPORT.md` at repo root.

Production health JSON:

- `GET /api/health/production` — wallets, scoring, shadow freshness
- `GET /api/health/worker` — last maintenance run, worker memory snapshot

Dashboard: `/maintenance` (CLI instructions; no unsafe web-triggered repairs).

### Render one-off jobs

Create a **one-off** job on the **worker** service (same env group as production), then run:

| Task | Command | Notes |
|------|---------|--------|
| Maintenance dry-run | `npm run maintenance:production -- --dry-run` | No DB mutations; still runs verify scripts |
| Maintenance live | `npm run maintenance:production` | Backfill categories, dedupe shadows, reconcile payouts |
| Reconcile payouts only | `npm run reconcile:shadow-payouts` | Add `-- --dry-run` to preview |
| Category backfill | `npm run backfill:categories` | Safe to repeat |
| Duplicate shadow cleanup | `npm run cleanup:duplicate-shadows` | Add `-- --dry-run` to preview |

**Safety:** Do not set `LIVE_TRADING_ENABLED`, `ALLOW_REAL_MONEY`, or lower TRADE_NOW thresholds. Maintenance never enables execution or fabricates prices.

The worker also runs `maintenance:daily` on a **24h** interval (`WORKER_INTERVAL_MAINTENANCE_DAILY_MS` to override).

### Full recovery sprint

```bash
npm run recovery:production -- --dry-run
npm run recovery:production
```

Writes `PRODUCTION_RECOVERY_REPORT.md` with before/after metrics and blocker forensics.

**Paper execution** (after recovery gates pass): set `EXECUTION_ENABLED=true` and `EXECUTION_PROVIDER=paper` on the **worker** only. Keep `LIVE_TRADING_ENABLED=false` and `ALLOW_REAL_MONEY=false`. Worker queues `portfolio:run` and `execution:run` must be active.

**Admin maintenance API** (web service): set `MAINTENANCE_ADMIN_TOKEN`, then:

- `POST /api/admin/maintenance/dry-run`
- `POST /api/admin/maintenance/run`

Header: `Authorization: Bearer <token>` or `X-Maintenance-Admin-Token`.

Worker periodic jobs (Render `augurium-worker`): the worker loop runs these on an interval (not only once at boot):

| Job | Redis queue | Default interval |
|-----|-------------|------------------|
| score-traders | `trader:score` | 30s |
| signal:generate | `signal:generate` | 120s |
| shadow:sync | `shadow:sync` | 30s |
| portfolio:run | `portfolio:run` | 300s |
| discord:enqueue | `discord:enqueue` | 300s |
| discord:dispatch | `discord:dispatch` | 60s |
| maintenance:daily | `maintenance:daily` | 24h (self-healing) |

Override per queue: `WORKER_INTERVAL_TRADER_SCORE_MS`, `WORKER_INTERVAL_SHADOW_SYNC_MS`, `WORKER_INTERVAL_MAINTENANCE_DAILY_MS`, etc. Disable periodic runs: `WORKER_PERIODIC_JOBS_ENABLED=false` (redis `LPUSH` triggers only).

Worker memory: set `WORKER_HEAP_HIGH_MB` (default `1400`) to skip noncritical jobs when heap is high. Memory is logged after each job and stored on maintenance runs.

## Auto-copy pipeline (worker)

Runs every **9 minutes** (`WORKER_INTERVAL_COPY_AUTO_PIPELINE_MS=540000`):

1. Global trade ingest (market-wide scan)
2. Discover new wallets from market holders
3. **Wallet activity** for current COPY traders (see below)
4. Rescore traders
5. Sync open positions from Polymarket
6. Paper-copy mirror (`PAPER_COPY_ENABLED=true`)
7. Live-copy prep (`LIVE_COPY_ENABLED=false` until you enable it)

| Variable | Default | Purpose |
|----------|---------|---------|
| `COPY_AUTO_PIPELINE_ENABLED` | `true` on Render worker | Master switch |
| `COPY_AUTO_INCLUDE_WALLET_ACTIVITY` | `true` | Refresh trades for COPY wallets each tick |
| `COPY_AUTO_WALLET_ACTIVITY_BATCH` | `8` | COPY traders to refresh per tick |
| `PAPER_COPY_ENABLED` | `true` | Paper mirror positions |
| `COPY_PAPER_BANKROLL_USD` | `10000` | Paper sizing reference |
| `COPY_WEEKLY_MAX_LOSS_PCT` | `0.2` | Halt **new** copy opens for the rest of the ISO week if paper PnL loss ≥ 20% of bankroll |
| `COPY_MAX_SOURCE_ROI_TO_MIRROR` | `0.15` | Skip mirror if leader position already &gt;15% ROI (too late) |

### Wallet activity (what it is)

**Wallet activity** pulls each trader’s **recent Polymarket trades** from the Data API (not just the global firehose). In the auto pipeline we only fetch wallets marked **COPY** in `CopyTraderControl`, so scores and copy decisions stay fresh for the traders you might mirror—without re-scanning the entire platform every 9 minutes.

The separate `wallet:activity` queue still rotates through **all** traders on its own schedule.

## Live copy trading (enable when ready)

**Do not** flip live flags until `/readiness` and `/copy` show system + live copy READY.

### Phase A — data & paper (now)

- `PAPER_COPY_ENABLED=true`
- `LIVE_COPY_ENABLED=false`
- `EXECUTION_ENABLED=false` or `EXECUTION_PROVIDER=paper`

### Phase B — credentials (Render env group, worker only)

| Secret | Required |
|--------|----------|
| `POLYMARKET_PRIVATE_KEY` | Yes |
| `POLYMARKET_API_KEY` | Yes |
| `POLYMARKET_API_SECRET` | Yes |
| `POLYMARKET_API_PASSPHRASE` | Yes |
| `POLYMARKET_FUNDER_ADDRESS` | Yes |

### Phase C — live gates (explicit, worker only)

```text
EXECUTION_ENABLED=true
EXECUTION_PROVIDER=polymarket
LIVE_TRADING_ENABLED=true
ALLOW_REAL_MONEY=true
LIVE_COPY_ENABLED=true
```

### Phase D — CLOB implementation

Set `POLYMARKET_CLOB_READY=true` only after `@polymarket/clob-client` is wired in `packages/execution` (until then, live mirrors are stored as `CopyLiveMirror` intents with status `BLOCKED`).

Checklist is also computed in `computeLiveCopyReadiness()` and shown on `/copy` via snapshot.

## Safety

- Polymarket live orders stay **blocked** until Phase C + D are complete.
- TRADE_NOW thresholds are **not** lowered in this deployment.
