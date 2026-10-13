# Transfer / loan completion report

Generated: 2026-10-13. Required transfer/loan implementation: **complete**.

## Required work — status

| Item | Status |
| --- | --- |
| Cross-league mid-season destination scheduling | Complete |
| Association windows vs 10 Jan review checkpoint | Complete |
| Accepted-deal careers (loan/transfer policies) | Complete |
| Calibration + positive controls | Complete |
| Finance data coverage report | Complete |
| Live browser loan verification | **Complete** (2026-10-13) |
| Regression suite | Complete |

## Live browser loan verification (2026-10-13)

Fixture: `window.__loadLiveLoanBrowserFixture()` → `js/simulation/liveLoanBrowserFixture.js`  
Seed `42`, careerId `live-loan-fixture-v1`, Atalanta CM age 19 / OVR 62.  
Pipeline: production `simulateSeason({ pauseForDecisions: true })` + `evaluateSquadDecision` + `generateLoanOffers` (sporting / finance / registration validation preserved).

### Results

| Check | Result |
| --- | --- |
| Manager loan recommendation | Pass — “Development discussion” with Review / Stay / Permanent |
| Loan card rendering | Pass — destination, parent Atalanta, wage, role, dates `2027-01-10 → 2027-05-31` |
| Decline / stay preserves contract | Pass — stay-and-compete kept employment Atalanta, wage 4000, `contractEndSeason` 4; season resumed |
| Accept updates playing club | Pass — playing **PEC Zwolle**; employment **Atalanta**; wage 8900; contract end 4 |
| Financial commitments once | Pass — `transactionIds` length 2 (borrower + parent); no extras after triple-click |
| Repeated clicks cannot duplicate | Pass — `dealBookingGuard` blocked further accepts |
| Resume destination fixtures | Pass — season card PEC Zwolle / Eredivisie · **953 min · 9 starts · 19 apps** |
| Loan completion / reassessment | Pass — “Loan ending” with Return / New loan / Ask to be sold; Return → Atalanta, `activeLoan.status: returned` |
| OVR formatting | Pass — whole numbers (e.g. OVR 61, attrs 63/65/…) |
| Console / stuck screens | No boot errors; season animation advanced via Skip phase + Continue |

### Screenshots

- `reports/screenshots/loan-01-manager-recommendation.png`
- `reports/screenshots/loan-02-loan-cards.png`
- `reports/screenshots/loan-03-return-reassessment.png`
- `reports/screenshots/loan-04-returned-to-parent.png`

### Fixes applied during this verification

1. Mid-season review now uses in-progress club minutes / games-to-date so development loans can fire live.
2. Loan offers stay on the manager decision until “Review loan options” (not pre-dumped into the tray).
3. Loan cards show parent club + loan dates.
4. Duplicate acceptance guard on `applyTransfer`.
5. Parent weekly wage restored on loan return.

## Commands run

```
node tests/transferLoanPipeline.test.mjs
node tests/transferLoanFollowup.test.mjs
node tests/crossLeagueCareer.test.mjs
node tests/browserFlowSmoke.test.mjs
node scripts/calibrateTransferLoan.mjs
```

(Plus fixture wage-restore assert and live browser session on `http://127.0.0.1:8787/`.)

## Calibration snapshot (post live-loan fixes)

- Scenarios: 936 · Offers: 1130 · Elite SENIOR ≤60 OVR: **0**
- Positive controls OK · Serie B 100m / 8m-vs-3m rejects · Loan start/return 156/156
- Finance: 490 clubs · 30 sourced / 460 estimated · no elite fallback

## Future work (explicitly out of scope)

- Expanded financial sourcing (more verified club budgets)
- Disk saving / persistent careers
- Conditional purchase obligations beyond the current option exercise path

## Versions

- Finance: `club-finance-v1-2026-10-09`
- Recruitment: `recruitment-v1-2026-10-09`
- Registration: `registration-windows-v1-2026-10-10`
- FX: `fx-2026-10-09`
