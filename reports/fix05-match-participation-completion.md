# Fix 05 completion report

## Root causes

1. **Zero treated as omitted** in `buildGoalEvents` (`Number(x) || 90`) attributed full-match goal/assist events to non-participants; cards/ratings lacked a minutes gate; knockout rating paths rated zero-minute players.
2. **Knockout finalization** added only ET goals (not assists) on some branches; penalty path re-rated without open-play recount; two-leg second legs could leave regulation-only stats.
3. **Ledger normalization** dropped clean sheets, cards, reasons, edition metadata; `Number(null)` rating became 0; zero-minute rows were boolean-only; aggregate labeled all non-participation as unused.
4. **Pre-kickoff training injury** could apply after selection minutes were already confirmed for simulation.
5. **Continental ledger ordering** appended match-day records before second-leg ET/pens finalize; `resolveContext` also dropped the finalize hook.
6. **Evidence** did not receive competition editions; clean sheets fell back to an all-competition league total when ledger flags were missing.

## Production changes (by file)

| File | Change |
| --- | --- |
| `matchEngine.js` | Explicit-zero minutes; on-pitch/card gates; RNG-parity burns for zero-minute; `finalizePlayerMatchStats` / `countUserOpenPlayEvents`; KO/ET/pens/two-leg finalize |
| `playerMatchDay.js` | Training injury before kickoff minutes; editionId; season CS roles; early-exit event reconcile |
| `playerSeasonLedger.js` | Structured non-participation; preserve CS/cards/edition/null rating |
| `continentalChronology.js` / `continentalTournament.js` | Edition on match-day; ledger push + post-finalize sync/accumulate; `onPlayerMatchFinalized` in context |
| `chronologicalSeason.js` / `nationalChronology.js` | Propagate edition IDs into match-day / ledger |
| `seasonSimulator.js` | `competitionEditions`; prefer ledger cleanSheet flags |
| `leagueTable.js` / UI | Distinct non-participation labels; no “Featured”/rating for zero minutes |
| `main.js` | Debug export of ledger non-participation / season totals |

## Data flow

Selection/availability → `processPlayerMatchDay` → `simulateMatch` / optional KO → **finalizePlayerMatchStats** → canonical match → ledger (`recordMatchObservation`) → `buildSeasonEvidence` (+ editions) → awards/development/UI.

Two-leg boundary: regulation match-day record is pushed, then `playOneMatch` finalize syncs the same object after ET/pens; stats accumulate once on finalize.

## Compatibility

- Omitted minutes still default to match duration for player fixtures.
- Legacy `nonParticipation[id]=true` remains readable; unknown details are not fabricated.
- Null rating stays unrated (no observation).
- Clean sheet: known true/false vs unknown preserved; season roles GK/CB/RB/LB/CDM @ ≥60′.

## Risks / limitations

- Zero-minute goal path burns legacy RNG (share-as-90) without attribution so seeded market/ownership tests stay aligned.
- Interactive browser ET/pens playback of a live cup second leg was not separately driven; engine cohorts cover ET/pens (99 ET / 75 pens in 1000 draws) and UI skip/finish validates non-participation labels.
- `playerAbility.test.mjs` retains two pre-existing failures (unchanged).
