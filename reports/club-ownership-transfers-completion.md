# Fix 02 completion: Club ownership after transfers and loans

Prepared 27 Oct 2026 (America/Chicago).

## Baseline

- **Base commit:** `9f87dee4303075517f0795a96d8a2a65a05f3801` (audited `main`, includes Fix 01).
- **Ownership authority:** dated `player.playingStints` via [`js/simulation/playingRegistration.js`](../js/simulation/playingRegistration.js) (`resolvePlayingClubAt`, `resolveValidatedClubSide`, `recordPlayingTransition`). Live `playingClubId` / `employmentClubId` remain the tip; employment alone never authorizes a club appearance.

## Before → after (engine probes)

Reproduction: `node scripts/probeOwnershipBaseline.mjs`

| Probe | Before | After |
| --- | --- | --- |
| Arsenal → Brentford (controlled `applyOfferToPlayer`) | 11 post-move Arsenal Champions League `playerMatches` (some with minutes); cup/europe still attached to Arsenal; `FA Cup Winners` without entitlement metadata | **0** post-move Arsenal continental `playerMatches`; edition focus stays Arsenal (world campaign); cup/continental attachment uses registration |
| Atalanta → Rudeš loan (`buildLiveLoanBrowserFixture` seed 42) | 4 post-move Atalanta continental `playerMatches` (incl. positive minutes) while playing at Rudeš | **0** post-move Atalanta continental `playerMatches`; `playingClubId=Rudeš`, `employmentClubId=Atalanta` |

Honors after a move may still credit Arsenal trophies when the player has **positive-minute contribution** for the winning club before departure; trophies now store `winningClubId` + `editionId` and are credited at most once. A stale campaign `won` flag alone is no longer enough.

## Changed files (principal)

- `js/simulation/playingRegistration.js` (new)
- `js/data/competitions/registrationPolicy.js` (new)
- `js/data/competitions/formats.js` (UEFA `playerRegistration` policy)
- `js/simulation/{dealPipeline,loanMarket,contractLifecycle,transferMigration,destinationSchedule,playerMatchDay,continentalTournament,continentalChronology,domesticCup,chronologicalSeason,playerSeasonLedger,seasonSimulator}.js`
- `js/simulation/ownershipTransferBrowserFixture.js` (new)
- `main.js` (fixtures + debug fields)
- `tests/clubOwnershipTransfers.test.mjs` (new)
- `tests/{loanPlayingLeague,crossLeagueCareer}.test.mjs` (false-coverage repairs)
- `scripts/{probeOwnershipBaseline,browserOwnershipChecklist}.mjs`

## Tests run

```bash
node tests/clubOwnershipTransfers.test.mjs   # 8 OK
node tests/loanPlayingLeague.test.mjs        # OK (same-league no longer soft-SKIP)
node tests/crossLeagueCareer.test.mjs        # OK (destination ownership required)
node tests/transferLoanPipeline.test.mjs
node tests/transferLoanFollowup.test.mjs
node tests/chronologicalSeason.test.mjs
node tests/continentalIntegrity.test.mjs
node tests/internationalIntegrity.test.mjs
node tests/contractLifecycle.test.mjs
node tests/freeAgentUiSoftlock.test.mjs
node tests/leagueSimulationDashboard.test.mjs
# Full repo: 24 PASS, 1 FAIL
# FAIL tests/playerAbility.test.mjs — pre-existing growth-cap assertion (unchanged by this fix)
```

## Browser acceptance

```bash
BASE_URL=http://127.0.0.1:8000 node scripts/browserOwnershipChecklist.mjs
```

| Case | Status | Evidence |
| --- | --- | --- |
| 1. Cross-country loan (live-loan → Rudeš) | Done | `qa/screenshots/checklist-ownership/01–03-*.png`; playing=Rudeš, employment=Atalanta |
| 2. Same-league permanent (ownership-transfer → Brentford) | Done | `04–06-*.png`; playing/employment=Brentford after Accept Offer |
| 3. Fix 01 free-agent empty-result smoke | Done | Fixture loads; Skip/Continue path still available |
| Destination continental in-field attach / delayed registration UI | Engine-covered; not separately driven in browser | Policy + unit tests in `clubOwnershipTransfers.test.mjs` |
| Loan return / next-season age tick in UI | Engine-covered (return + snapshot tests) | Browser return path not separately scripted |

## Confirmations

- Pre-move Arsenal history remains in continental/cup `playerMatches` dated before the move.
- World edition/draw is not redrawn when the user leaves the focus club.
- Borrower league table regression (Atalanta → Zwolle) still passes.
- Loan employment terms preserved; parent renewal while on loan does not switch playing club.
- Fix 01 free-agent soft-lock suite still passes.

## Limitations (not claimed complete)

- Destination continental attachment for a club **already in the same edition field** after a winter move is gated by format `playerRegistration` (UEFA: no immediate league-phase eligibility). Arsenal→Brentford / Atalanta→Rudeš correctly get **no** destination continental path.
- Contribution-based medals after departure use positive minutes for the winning club; finer medal rules (e.g. final-only) are not invented here.
- Fixes 03 (league membership after promotion/relegation) and 04 (academy) remain separate.
