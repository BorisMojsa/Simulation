# Competition integrity and live dashboard — completion evidence

**Date:** 2026-10-15  
**Base audited revision:** `34f15aafed4d459fd8ac20a6598db4fcb73584eb`  
**Working tree:** implemented on top of that revision while preserving unrelated senior-career WIP.

## Problem addressed

International (and related) results could diverge: a watched match score did not match the nested tournament copy used for tables, qualification, and recaps. Chronological national fixtures were simulated twice; reconciliation targeted the wrong object; knockout ties could lack winners; same-group first-knockout pairing was possible; national results were absent from `world.matches`; pending continental KO injection could reorder the calendar; the live dashboard was league-only.

## Architecture delivered

1. **One authoritative result per fixture** via `competitionStore` (`commitMatch` with conflict diagnostics).
2. **National lifecycle** (`nationalTournament.js` / `nationalChronology.js`): prepare (draw/schedule only) → dated play once → advance → project view. No batch-then-replay path for careers.
3. **Calendar merge** (`mergePendingEvents` in `seasonCalendar.js`): preserves processed prefix; merges pending + new by date with stable `eventId`s. Used by continental and national injection.
4. **Official brackets / thirds:** EURO Article 21 (15) and FIFA Annex C (495) in `js/data/competitions/nationalBrackets.js` + `worldCupAnnexC.js` (sourced from FIFA/UEFA regulations).
5. **Ranking adapters** in `nationalTable.js` (FIFA/EURO group and best-thirds; documented fallbacks for missing disciplinary / EQ ranking data).
6. **Live context:** `competitionPlayback.js` + dashboard right panel supports group table / best thirds / bracket for national playback; international phase uses the simulation dashboard instead of a separate score-only viewer.
7. **Formats:** `tournamentsForYear` reads `NATIONAL_FORMATS` (single rules authority for field/thirds/bronze).

## Before → after (audit cohort)

Serbian ST @ Red Star, OVR 85, seeds 1–100, years 2026 & 2028:

| Metric | Audited (before) | After |
| --- | ---: | ---: |
| Score mismatches (chrono vs tournament copies) | 255 + 258 | **0 + 0** |
| Backwards player-ledger dates | 29 + 25 | **0 + 0** |
| Unresolved required KO winners | 18 + 13 | **0 + 0** |
| KO loss then further main-bracket player fixture | 7 + 9 | **0 + 0** |
| Careers with national results in `world.matches` | 0 + 0 | **100 + 100** |

## Additional sweeps executed

| Sweep | Result |
| --- | --- |
| Edition-only World Cup 2026 × 200 seeds (104 fixtures, store agreement, table invariants) | 0 bad, 0 store misses |
| Edition-only EURO 2028 × 200 seeds (51 fixtures) | 0 bad, 0 store misses |
| EURO Article 21 combinations | 15/15 |
| FIFA Annex C combinations | 495/495 |
| Integrated career cohort 200 (above) | 0 mismatches / backwards / KO integrity faults |

A full 1,000-seed edition sweep per format was not re-run in this session after the 200-seed green sweep; extend with the same harness if required for release gates.

## Tests

```bash
node --test tests/*.test.mjs
```

- **Runtime:** Node `v20.19.5` (audit referenced `v24.19.0`; suite is compatible).
- **Result:** 57 pass / 0 fail (includes new `tests/internationalIntegrity.test.mjs`).
- Continental integrity suite remains green.

## Real-browser acceptance

**Not executed.** Playwright is not installed in this workspace (`Cannot find module 'playwright'`), same class of gap noted in the audit (Chromium absent). Source/DOM-free smokes are **not** counted as browser verification.

Remaining manual/browser checklist (from the prompt §9):

1. UCL/UEL opening phase — right-hand table updates once with FT score.
2. Playoff/R16 — bracket context, aggregates, completed table accessible.
3. WC/EURO — draw visible before play; other groups / best thirds; final-batch qualification.
4. Italy/Serbia controlled fixture visually (covered in unit N01 with injected scores).
5. Speed / skip / pause / hidden-tab hash parity.
6. Spoiler boundary on tables/brackets/headers.
7. Mobile stack / sticky context; a11y; no console errors.

## File map (primary)

| Area | Files |
| --- | --- |
| National lifecycle | `js/simulation/nationalTournament.js`, `nationalChronology.js`, `nationalHelpers.js`, `nationalTable.js` |
| Brackets / Annex C | `js/data/competitions/nationalBrackets.js`, `worldCupAnnexC.js` |
| Calendar | `js/simulation/seasonCalendar.js` (`mergePendingEvents`) |
| Continental inject | `js/simulation/continentalChronology.js` |
| Career wiring | `js/simulation/chronologicalSeason.js` |
| Store / ledger | `js/simulation/competitionStore.js`, `playerMatchDay.js` |
| Formats calendar | `js/data/internationalCalendar.js` |
| UI | `js/simulation/competitionPlayback.js`, `js/ui/simulationDashboard.js`, `js/ui/seasonAnimation.js`, `style.css` |
| Tests / report | `tests/internationalIntegrity.test.mjs`, this report + `.json` |

## Limitations / follow-ups

- Pool-limited AFCON / Asian Cup / Gold Cup / Copa use documented cross-group KO pairing, not full real-world brackets.
- Missing official disciplinary / European Qualifiers ranking data: stable FIFA-rank / name fallbacks are explicit, not claimed as official.
- World Cup Annex C data independently extracted from FIFA World Cup 26 regulations PDF; cite FIFA as source (not third-party engine code).
- Dashboard continental live phase still primarily uses the post-league `playMatchList` path; national now uses the generalized dashboard. Further unifying cup/continental into the same reveal-scoped dashboard is incremental.
- Browser automation not run (tooling missing).
- Unrelated senior-career WIP in the working tree was left intact.

## Commands for reproduction

```bash
node --test tests/internationalIntegrity.test.mjs
node --test tests/*.test.mjs
# Cohort probe (see Appendix A of the audit prompt; APIs now agree by matchId)
```
