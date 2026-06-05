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
| `WEB_PRISMA_CONNECTION_LIMIT` | `3` | Avoid pool timeout (was 9 on Starter) |
| `WEB_MAX_CONCURRENT_QUERIES` | `2` | Limits parallel heavy fallbacks |
| `WEB_SNAPSHOT_STALE_MS` | `600000` | Treat snapshots older than 10m as stale |
| `NODE_OPTIONS` | `--max-old-space-size=460` | Headroom under 512MB plan |

**Worker:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKER_INTERVAL_WEB_SNAPSHOT_REFRESH_MS` | `180000` | Snapshot refresh interval (1–5 min) |

Health check URL: `/api/health` (ping + snapshot ages only).

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

## Safety

- Polymarket live execution remains **NOT_READY** in code.
- TRADE_NOW thresholds are **not** lowered in this deployment.
