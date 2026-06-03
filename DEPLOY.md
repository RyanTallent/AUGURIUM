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
| `SHADOW_SYNC_BATCH_SIZE` | `500` | Shadow trades repriced per run (open + closed, stale first). Do **not** set legacy `SHADOW_MAX_UPDATE=1` — it is ignored but was capping the fleet to 1. |
| `SHADOW_PRICE_STALE_MS` | `21600000` (6h) | Trade age after which price is STALE (real tape only) |

After changing env vars, **redeploy the worker** (and web if dashboard Discord status should reflect new values).

## Post-deploy maintenance

```bash
npm run db:push          # apply schema (includes new category/shadow fields)
npm run backfill:categories
npm run verify:production-health
```

Production health JSON: `GET /api/health/production` on the web service (or `npm run verify:production-health`).

Worker periodic jobs (Render `augurium-worker`): the worker loop runs these on an interval (not only once at boot):

| Job | Redis queue | Default interval |
|-----|-------------|------------------|
| score-traders | `trader:score` | 30s |
| signal:generate | `signal:generate` | 120s |
| shadow:sync | `shadow:sync` | 30s |
| portfolio:run | `portfolio:run` | 300s |
| discord:enqueue | `discord:enqueue` | 300s |
| discord:dispatch | `discord:dispatch` | 60s |

Override per queue: `WORKER_INTERVAL_TRADER_SCORE_MS`, `WORKER_INTERVAL_SHADOW_SYNC_MS`, etc. Disable periodic runs: `WORKER_PERIODIC_JOBS_ENABLED=false` (redis `LPUSH` triggers only).

## Safety

- Polymarket live execution remains **NOT_READY** in code.
- TRADE_NOW thresholds are **not** lowered in this deployment.
