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
| `SCORE_TRADERS_BATCH_SIZE` | `50` | Wallets scored per worker run |

After changing env vars, **redeploy the worker** (and web if dashboard Discord status should reflect new values).

## Post-deploy maintenance

```bash
npm run db:push          # apply schema (includes new category/shadow fields)
npm run backfill:categories
npm run verify:production-health
```

Worker queues (Redis): ensure `score-traders`, `signal:generate`, and `shadow:sync` run on schedule.

## Safety

- Polymarket live execution remains **NOT_READY** in code.
- TRADE_NOW thresholds are **not** lowered in this deployment.
