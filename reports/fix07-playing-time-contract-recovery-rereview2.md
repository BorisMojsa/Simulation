# Fix 07 re-review completion report (after e9f914e)

**Playing-time assessment, contract continuity and free-agent recovery — follow-up after CHANGES REQUIRED at e9f914e**

Prepared 2026-10-29. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Identity

| Item | Value |
| --- | --- |
| Original accepted base (Fix 06) | `8313f27167c18c18079471a44b36878bd347638a` |
| Prior review | `2515e95073a8634871443b591802d2ed2ee49612` |
| This-review base | `e9f914e0e57b04fe75e65c852fe7d8be6a6fdf0c` |
| Branch | `fix/07-playing-time-contract-free-agent-recovery` |

Final commit / remote SHAs are recorded in the package `manifest.json` after push.

## Closed findings (remaining branches)

### R1 — Pending parent review before loan settlement
- Season entry checks pending parent review before irreversible loan expiry release / free-agent advance.
- Loan return paths preserve unresolved parent renewal; borrower registration may end without inventing extra periods.
- Maintained co-terminal loan/parent regression + browser B03 coterminal decline.

### R2 — Same-boundary renewal terms
- Boundary renewal offer identity/terms reused for the owned review window; facade/regenerate does not silently rebuild wages/years.
- F11 asserts identical review ID, offer ID, wage, years after facade refresh.

### R4 — Legacy period proof and league/cup scope
- Unscoped player-level ledger without period membership is not exact current-period evidence.
- League-only numerators use league opportunities; all-club totals are not divided by league-only capacity.
- Legacy cup minutes no longer promote mixed 1050/3420 shares.

### R5 — Deferred continental ET capacity
- Deferred second-leg finalization propagates `fixtureOpportunityCapacity` (120) independently of played minutes.
- Substitute 20-minute appearances assess as 20/120.

### R7 — Browser operations and packaging
- B01 requires assessment + clicks Review loan options and exercises stay/decline.
- B03 keeps negative non-renewal, exercises positive wants-renewal Decline through UI, and co-terminal parent/loan decline.
- B04 starts empty FA desk; wait/search/Accept through live UI.
- B07 duplicate accept via `__acceptPipelineOffer` production seam (`journal-accepted`); finance/deal ids unchanged.
- Continue snapshots captured immediately before `#continue-btn`.
- Package includes raw case JSON, fixtures, screenshots, Fix 05/06 machine reports, and Fix 06↔final 48-record baseline comparison.

R3 and R6 remain closed from e9f914e; preserved.

## QA

| Check | Result |
| --- | --- |
| Appendix A remaining-path probes | 4/4 PASS |
| Appendix B boundary terms | PASS (stable wages/IDs) |
| Original 9 probes | 9/9 PASS |
| Focused `playingTimeContractRecovery.test.mjs` | 39/39 PASS |
| Fix 07 exporter | 48 ordinary + 8 dedicated PASS |
| Fix 06 exporter | PASS |
| Fix 05 exporter | PASS |
| Full `node --test tests/*.test.mjs` | 112 pass / 1 failed file (`playerAbility` — same two baseline assertions) |
| Browser Fix 07 B01–B07 | PASS |
| Browser Fix 05 (incl. `live-et-pens-season-continue`) | PASS |
| Browser Fix 06 | PASS (see package timestamps) |
| Baseline-compatible 48-record Fix06 vs final | 48/48 records; share arithmetic differs as expected |

## Constraints preserved

No retune of ratings, awards, growth, injury, or OVR calibration. Fixes 01–06 ancestry retained. No merge/deploy/Fix 08.
