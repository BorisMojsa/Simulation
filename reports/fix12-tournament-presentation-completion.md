# Fix 12 completion — Tournament presentation and win totals

**Status:** READY FOR INDEPENDENT REVIEW (local gates)  
**Branch:** `fix/12-tournament-presentation-win-totals`  
**Accepted base:** `fa1445c731335e20d21f93cc412f451d2c77889d`  
**Audit date:** 6 November 2026

## Behavior before / after

| Area | Before | After |
| --- | --- | --- |
| Career overview opening phase | National `groups[]` fell through to **Knockout** | Shared projection → **Group stage** / **League phase** / Knockout-only / Unavailable |
| Win totals | Group table W looked like tournament W; no total record | Separate group/league-phase record and total tournament record |
| Round counts | “Player path rounds / Bracket rounds” readable as wins | Clarified as path/bracket round counts, not games won |
| Playback stage | Completed campaign forced bracket mode immediately | Revealed-fixture `stageMode`; table until first revealed KO |
| Shootouts / ET | Not distinguished in summaries | Match W/D/L from post-ET goals; separate pens won/lost; brief note |

**Counting convention:** P/W/D/L and GF/GA use match goals after extra time; penalty kicks excluded. A 1–1 (5–4 pens) match is P1 W0 D1 L0 GF1 GA1 + shootout won. Aggregate parents are not games.

## Code changes (production)

- `js/ui/tournamentPresentation.js` — new pure projection/labels/HTML summary
- `js/simulation/competitionPlayback.js` — revealed stage mode; continental `frozen` seam; `resolveStageMode`
- `js/ui/simulationDashboard.js` — stage transition on reveal; live revealed-only record banner
- `js/ui/rendering.js` — competitions overview/phase/fixtures use shared projection
- `js/ui/seasonAnimation.js` — national/continental recap summaries and phase notes
- `js/simulation/nationalTournament.js` — expose `playerNation` on campaign view (display scope)

Tests/scripts/reports as listed in the review package.

## Acceptance matrix

### F01–F18 (`tests/tournamentPresentation.test.mjs`)

| ID | Result | Evidence |
| --- | --- | --- |
| F01–F18 | **PASS** (18/18) | `qa/fix12-runs/final/logs/tournamentPresentation.test.log` |
| F01 numbers | Group P3 W2 D1 L0; Total P8 W7 D1 L0; Winners | `qa/fix12-runs/final/fixtures/f01-campaign.json` |

### B01–B08 (real Chrome + playwright-core)

| ID | Result | Evidence |
| --- | --- | --- |
| B01–B08 | **PASS** (8/8) | `qa/fix12-runs/browser/browser-report.json` |

### Suites

| Command | Result |
| --- | --- |
| Baseline full suite on accepted base | 227 pass / 0 fail |
| Focused integrity + formats + presentation | 44 pass / 0 fail (`qa/fix12-runs/focused-regression.txt`) |
| Final full suite | **245 pass / 0 fail** (`qa/fix12-runs/full-suite.txt`) |
| Gameplay parity (matched seeds) | national + continental fingerprints stable (`qa/fix12-runs/final/gameplay-parity/`) |

Protected gameplay fingerprints (match IDs, scores, phase tables, winners) unchanged by presentation; only display strings/derived presentation fields differ.

## Legacy limitations

- Editions missing raw fixture inventories surface as **Record unavailable** / **partial**, never as a false exact zero total.
- Showcase / not-entered campaigns stay **No entry**.
- Dormant continental dashboard playback is not activated; continental builder `frozen`/`complete` seam is covered as a selector only.

## Protected gameplay confirmation

F01/UCL control fingerprints re-derived on identical recipes match. Presentation helpers do not call `commitMatch` and do not mutate campaign arrays (F16).