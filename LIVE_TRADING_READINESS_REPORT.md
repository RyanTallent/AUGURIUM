# LIVE TRADING READINESS REPORT

Generated: 2026-06-03T17:16:39.066Z

## Verdict

**LIVE TRADING READY = NO**

Overall: **FAIL** (38/100)

## Root causes found

1. **Payout corruption**: Exit path could apply resolution-style PnL while UI showed flat entry≈exit (e.g. $3800 on $100 at 0.025/0.025).
2. **Runner misuse**: Low entry treated as huge ROI without price reaching runner target (YES +50% → entry×1.5, not $1 unless resolved).
3. **Stale repricing**: Closed shadows could be repriced without resetting realized PnL.
4. **Zero ROI dominance**: Most closed trades lack post-entry marks — breakeven bucket, not wins.

## Fixes applied

- Centralized share-based payout (`packages/shadow/src/payout.ts`)
- Exit rules + partial/runner/consensus collapse use correct formulas
- `invalidForAnalytics` + `/shadow/payout-audit` + `npm run reconcile:shadow-payouts`
- Closed shadows skip price-only DB updates
- Readiness fails on impossible PnL, payout audit, invalid rows, ROI anomalies

## Remaining blockers

- Shadow analytics not trustworthy
- ROI anomalies: 7
- Invalid for analytics: 26
- Paper validation 0 / 100

## Shadow analytics (trustworthy metrics)

| Metric | Before (prod) | After (authoritative) |
|--------|---------------|------------------------|
| Average ROI | 606.1% (corrupt) | -0.8% |
| Average ROI raw | — | -0.8% |
| Median ROI | 0.0% | 0.0% |
| Win rate | 33.5% | 0.6% |
| Loss rate | 0.4% | 2.6% |
| Zero ROI | 66.2% | 88.9% |
| Profit factor | 2735 (corrupt) | 0.01 |
| Trustworthy | no | no |
| Trustworthy sample | — | 154 (excl. 26 invalid) |

## Shadow payout audit

Impossible PnL (entry≈exit, PnL≠0): **0**
Invalid for analytics: **26**
ROI > 100%: **7** · > 500%: **0** · > 1000%: **0**

## ROI anomaly counts

Corrupt trades: **7**
Diagnosis: **outlier_corruption**

- gt_100pct: 2
- gt_200pct: 5

## Duplicate active shadows

Groups: **0**
- None

## Paper validation

Progress: **0 / 100**
Opens: 1 · Closes: 0
EV: 0.00%

## Zero ROI breakdown

- expired_without_price: 93
- missing_entry_price: 11
- no_post_entry_trade: 56

## Warnings

- Stale shadow pricing 100%
