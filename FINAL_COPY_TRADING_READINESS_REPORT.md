# FINAL COPY TRADING READINESS REPORT

Generated: 2026-06-03T23:51:45.956Z

## Verdict

**PAPER TRADING READY = NO**

**LIVE TRADING READY = NO** (live/real money remain OFF by policy)

## Metrics (before → after)

| Metric | Before | After |
|--------|--------|-------|
| Readiness score | 38 | 38 |
| Impossible PnL | 0 | 0 |
| ROI anomalies (valid rows) | 0 | 0 |
| Duplicate groups | 0 | 0 |
| Analytics trust | — | FAIL |
| Category coverage % | 67.6 | 67.6 |
| Paper opens | — | 1 |
| Paper closes | — | 0 |
| Copy paper opens | — | 0 |
| Copy paper closes | — | 0 |
| Portfolio ACCEPT | — | 0 |

## Top traders to copy

- None meet COPY gates today

## Copy portfolio recommendations

- **Top 1 trader** — est. 30d ROI 4.4%
- **Top 5 traders (equal weight)** — est. 30d ROI 0.8%
- **Top 10 traders (equal weight)** — est. 30d ROI 1.1%
- **Risk-adjusted top traders** — est. 30d ROI 0.0%
- **Category specialists** — est. 30d ROI 0.8%
- **Diversified copy basket** — est. 30d ROI 0.8%

## Risk allocations

- max 5% capital per trader
- max 20% per market
- max 20% per category
- max 30% per event
- max 20% trader drawdown before auto-disable

## Acceptance bottleneck forensics

Acceptance rate: 0.0% (0 ACCEPT / 2000 REJECT)

### Threshold bottlenecks
- 2942 rejections with composite < 80 (ACCEPT requires ≥80 — not lowered)
- 58 near-miss rejections in 75–79 band (WATCH only)

### Signal bottlenecks
- many RESEARCH signals vs TRADE_NOW — promotion funnel blocked

### Allocation bottlenecks
- duplicate market exposure blocked
- ACCEPT count is 0 — portfolio engine has not approved any simulated allocation

## Outlier opportunities (surface only)

19 flagged — never auto-traded

## Production repairs applied

- fix_impossible_flat_pnl: {"fixed":0,"dryRun":false,"examined":180}
- orphan_shadow_runs: {"shadowCleared":0,"staleRunningCleared":0}
- duplicate_shadow_cleanup: {"closed":0,"dryRun":false,"groupsAffected":0}
- shadow_payout_reconcile: {"fixed":0,"dryRun":false,"flagged":15,"examined":180,"unreconcilable":11}
- shadow_trust_repair: {"dryRun":false,"examined":154,"repaired":0,"auditTrail":[],"flaggedInvalid":0}

## Remaining blockers

- shadow trust checks failing
- shadow analytics not trustworthy
- no traders meet COPY criteria today
- paper closes 0/100 required for paper validation

## Why live trading stays NO

- `EXECUTION_ENABLED` / `LIVE_TRADING_ENABLED` / `ALLOW_REAL_MONEY` must not be enabled without explicit ops review
- Readiness gates for shadow integrity and paper validation must pass first

## Exact next step

Run `npm run recovery:production` on Render worker against production DATABASE_URL, then re-run this report.
