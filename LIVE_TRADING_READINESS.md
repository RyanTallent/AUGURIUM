# Live Trading Readiness Sprint

AUGURIUM does **not** enable live trading in this sprint. The goal is proof-oriented validation.

## Phase 1 — Shadow portfolio audit (fixes)

| Issue | Fix |
|-------|-----|
| Sync used `shadow.createdAt` for entry tape | Use `signal.createdAt + entryDelayMs` via `shadowEntryMs()` |
| Pre-entry tape marked as current price | `resolveShadowPrice` ignores tape before entry |
| `priceAtOrAfter` fell back to pre-entry price | Returns `null` when no post-entry trade |
| MFE/MAE stuck at 0 on create | Seed with `updateExcursions()` at open |

Verify: `npm run verify:shadow-audit`

## Phase 2 — Duplicate prevention

- One active shadow per `marketId + side + signalType`
- Check before create; index on `(marketId, side, signalType, status)`
- Backfill: `npm run backfill:shadow-signal-type`
- Verify: `npm run verify:shadow-duplicates`

## Phase 3 — Shadow analytics

Dashboard: `/shadow/analytics`  
API module: `computeShadowAnalytics()` in `@augurium/database`

## Phase 4 — Signal validation

- Persist `baseSignalType`, `promotionReasons`, `classificationMeta`, `skipReason` on `Signal`
- Dashboard: `/signals/validation`

## Phase 5 — Trader reliability

`computeTraderReliability()` — flags tiny samples, fake edge, rank inflation

## Phase 6 — Portfolio validation

`computePortfolioValidation()` — allocation accept rate, exposure, drawdown

## Phase 7 — Paper execution validation

`computePaperValidation()` — requires 100+ closed paper positions for PASS

## Phase 8 — Discord intelligence

Actionable `Why` fields on embeds; events: `HIGH_CONVICTION_SIGNAL`, `SHADOW_WINNER`, `SHADOW_LOSER`

## Phase 9 — Readiness report

Dashboard: `/readiness`  
CLI: `npm run verify:readiness`

### Live trading gates (all required)

- Shadow analytics trustworthy (zero ROI/MFE rates below thresholds)
- No duplicate active shadows
- Shadow sync acceptable; stale pricing under control
- 100+ completed paper trades with positive expectancy
- Execution reconciliation healthy (manual check)

## Deploy steps

1. `npm run db:push` (new Signal + ShadowTrade columns)
2. `npm run backfill:shadow-signal-type`
3. Deploy worker + web; run shadow sync + generate-signals
4. Re-run `verify:shadow-audit` after one full sync cycle
