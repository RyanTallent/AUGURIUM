# LIVE TRADING READINESS REPORT

Generated: 2026-06-02 (shadow analytics correction sprint)

## Verdict

**LIVE TRADING READY = NO**

Overall: **FAIL** (expected until production deploy + cleanup scripts run)

Evidence: production showed corrupt headline analytics (606% average ROI, 2735 profit factor, 66% zero ROI with 0.4% loss rate). This sprint fixes measurement and gates; it does not inflate performance.

## Root causes found

1. **Outlier corruption (few trades, huge impact)**  
   Headline averages used raw stored `roi`, which included extreme values from implausible entry prices (e.g. entry &lt; $0.02) or inconsistent close accounting. Median ROI stayed ~0% while mean exploded — classic outlier distortion.

2. **Zero ROI is mostly pricing, not “loss”**  
   ~66% of closes had ~$0 realized PnL with entry≈exit or no post-entry marks. Breakeven bucket dominates; loss rate looked artificially low (0.4%).

3. **Analytics engine used wrong field**  
   Aggregates trusted `ShadowTrade.roi` without reconciling to `realizedPnl / simulatedSizeUsd`.

4. **Duplicate active shadow**  
   At least one `marketId + side + signalType` group had multiple OPEN rows (pre-cleanup).

5. **Paper validation not started**  
   0 / 100 closed paper positions.

## Fixes applied (code)

| Area | Change |
|------|--------|
| ROI truth | `closedPositionRoi = realizedPnl / simulatedSizeUsd` |
| Analytics | Headline avg/median/PF exclude \|ROI\|&gt;100% anomalies |
| Forensics | `computeShadowRoiForensics`, anomaly buckets, diagnosis |
| Zero ROI | `computeZeroRoiBreakdown` categories on `/readiness` |
| Entry gate | Reject opens with price outside 0.02–0.98 |
| Freshness | `auditShadowFreshness` verifies numerator/denominator |
| Duplicates | `cleanup-duplicate-shadows.mjs` + prevention at open |
| Reconcile | `reconcile-shadow-roi.mjs` aligns stored roi to PnL |
| UI | `/shadow/anomalies`, hardened `/shadow/analytics`, `/readiness` |
| Readiness | FAIL on anomalies, duplicates, corrupt analytics, paper &lt; 100 |

## Production deploy steps

1. `npm run db:push` (adds `ShadowTrade.signalType`, signal classification fields if missing)
2. `npm run backfill:shadow-signal-type`
3. `npm run reconcile:shadow-roi`
4. `npm run cleanup:duplicate-shadows` (review with `--dry-run` first)
5. Redeploy worker + web; run shadow sync cycles
6. `npm run verify:shadow-roi-forensics` and `npm run report:readiness`

## Shadow analytics — before vs after (methodology)

| Metric | Production (corrupt) | After correction (trustworthy defs) |
|--------|----------------------|-------------------------------------|
| Average ROI | 606.1% | Mean of authoritative ROI, **excluding** \|ROI\|&gt;100% |
| Median ROI | 0.0% | Median of same trustworthy set |
| Profit factor | 2735.90 | Gross win / gross loss on non-anomaly trades only |
| Zero ROI | 66.2% | From zero-ROI breakdown (PnL ≈ $0) |
| Win / loss | 33.5% / 0.4% | Win/loss/breakeven from authoritative ROI |

Re-run `/shadow/analytics` after deploy to see live corrected numbers.

## ROI anomaly buckets (forensics)

Inspect via `npm run verify:shadow-roi-forensics` or `/shadow/anomalies`:

- gt_100pct (&gt;100% ROI)
- gt_200pct, gt_500pct, gt_1000pct, gt_5000pct

Each bucket reports count and contribution to raw mean (diagnostic).

## Duplicate active shadows

Target: **0** groups. Use `npm run verify:shadow-duplicates` after cleanup.

## Paper validation

Progress labels: `0 / 100`, `25 / 100`, `50 / 100`, `100 / 100` on `/readiness`.

Current production: **0 / 100** closes.

## Remaining blockers

- Shadow analytics corrupted until reconcile + repricing
- ROI anomaly count &gt; threshold (default 3) until outliers reviewed
- Duplicate active group(s) until cleanup script runs
- Paper closes &lt; 100
- Live execution remains disabled in env (`EXECUTION_ENABLED=false`)

## Warnings (non-blocking)

- Stale shadow pricing above threshold
- Scoring backlog
- TRADE_NOW gates block promotion (by design)

## Constraints upheld

- Live trading **not** enabled  
- No synthetic prices or fake fills  
- TRADE_NOW thresholds unchanged  
- Readiness scores not manipulated — FAIL reflects truth  
