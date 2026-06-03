# PRODUCTION MAINTENANCE REPORT

Generated: 2026-06-03T22:18:12.845Z
Mode: **DRY RUN**

## Verdict

**LIVE TRADING READY = NO**

Readiness: **38/100**

## Metrics (before → after)

| Metric | Before | After |
|--------|--------|-------|
| Impossible PnL | 0 | 0 |
| ROI anomalies | 7 | 7 |
| invalid_for_analytics | 26 | 26 |
| Duplicate active groups | 0 | 0 |
| Category coverage % | 39.7 | 39.7 |
| Scoring backlog | 0 | 0 |
| Shadow FRESH % | 0 | 0 |
| Shadow STALE % | 100 | 100 |
| Ingestion failures 24h | 788 | 788 |
| Worker heap MB | — | — |

## Steps

- orphan_shadow_runs: dry_run
- duplicate_shadow_cleanup: dry_run
- shadow_payout_reconcile: dry_run
- db:generate check: failed
- backfill:categories: dry_run
- verify:shadow-roi-forensics: failed
- verify:shadow-duplicates: ok
- verify:production-health: failed
- verify:readiness: failed
