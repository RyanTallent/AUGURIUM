# PRODUCTION RECOVERY REPORT

Generated: 2026-06-03T23:51:21.242Z
Mode: **LIVE REPAIR**

## Verdict

**LIVE TRADING READY = NO**

Paper start eligible (data gates + env): **NO**

Run npm run recovery:production before enabling paper execution.

## Metrics (before → after)

| Metric | Before | After |
|--------|--------|-------|
| Readiness score | 38 | 38 |
| Impossible PnL | 0 | 0 |
| ROI anomalies | 0 | 0 |
| invalid_for_analytics | 26 | 26 |
| Duplicate active groups | 0 | 0 |
| Category coverage % | 67.6 | 67.6 |
| Scoring backlog | 0 | 0 |
| Shadow FRESH % | 0 | 0 |
| Shadow STALE % | 100 | 100 |
| Ingestion failures (24h) | 788 | 788 |
| Paper opens | 1 | 1 |
| Paper closes | 0 | 0 |

## Maintenance

Status: success
- fix_impossible_flat_pnl: ok
- orphan_shadow_runs: ok
- duplicate_shadow_cleanup: ok
- shadow_payout_reconcile: ok
- shadow_trust_repair: ok

## Ingestion health

Healthy: false
- 788 ingestion run(s) failed in the last 24h (historical; new pagination exhaustion resets do not increment this)

## Shadow trust

Trustworthy: false
- entry_equals_exit_pnl_zero: PASS — 158/158 flat closes with ~0 PnL; impossible=0
- payout_formula_consistency: FAIL — 15 mismatches in sample of 180
- invalid_rows_flagged: PASS — 26 rows marked invalid_for_analytics

## Portfolio / execution

Accepted: 0 · Rejected: 2000 · Watch: 0
Acceptance rate: 0.0%
Execution blocked: 1 · placed: 1

Zero accepts is expected when signals are RESEARCH/WATCHLIST, scores below thresholds, or capital caps are full — not necessarily a bug.

### Top portfolio rejection reasons

- composite score below 80 (1960)
- duplicate market exposure blocked (40)

### Top execution block reasons

- conflicting YES/NO position on same market (1)

## Readiness forensics

### Shadow analytics not trustworthy
- Root cause: Too many invalid or outlier ROI rows for trustworthy headline analytics.
- Blocks paper: YES
- Blocks live: YES
- Action: npm run maintenance:production
### Invalid for analytics: 26
- Root cause: Unreconcilable or corrupt rows flagged invalid_for_analytics.
- Blocks paper: YES
- Blocks live: YES
- Action: npm run reconcile:shadow-payouts
### Paper validation 0 / 100
- Root cause: Fewer than 100 closed paper positions — sample not statistically ready for live.
- Blocks paper: NO
- Blocks live: YES
- Action: Keep EXECUTION_ENABLED=true (paper mode); run portfolio + execution until 100 closes
### Stale shadow pricing 100%
- Root cause: Post-entry tape missing or SHADOW_PRICE_STALE_MS exceeded.
- Blocks paper: YES
- Blocks live: NO
- Action: npm run shadow:sync

## Why live trading is not ready

- Shadow analytics not trustworthy
- Invalid for analytics: 26
- Paper validation 0 / 100

## Safety

- LIVE_TRADING_ENABLED: OFF (unchanged)
- ALLOW_REAL_MONEY: OFF (unchanged)
- Polymarket CLOB live: NOT_READY
