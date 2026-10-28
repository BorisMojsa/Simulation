# Fix 01: Free-agent UI soft-lock — completion report

## Branch / baseline

- **Working branch:** `fix/01-free-agent-ui-softlock`
- **Starting commit:** `50fd6cfb9d614bd10da0f4e16a0a40df0bd601d2` (`main`, audited baseline)
- **Previously reviewed push:** `50140f5633b2b79cb9b1ed17e46c97d6767a4339`
- **Follow-up status:** F01–F04 repairs committed and pushed for review. Do not merge until independent sign-off.

## Confirmed cause

`simulateSeason` correctly returns a free-agent payload (`freeAgent: true`, period record, no `league` / `standings`). `showSeasonAnimation` → `animateSeasonSequence` required league data, logged `Missing required season data`, opened `#season-animation-overlay`, and never wired Continue / `onContinue`. The career desk stayed trapped.

## Final behavior

1. Explicit free-agent results take a dedicated recap path **before** league validation (classified by result flags, not current club state).
2. Compact “Free-agent period complete” recap + enabled Continue; match/dashboard/award phases stay hidden.
3. Continue closes the overlay once, redraws history authoritatively, regenerates desk controls, and syncs the next action via `selectNextCareerAction`.
4. Async presentation returns a handled promise; missing club-season data and render failures recover the desk without re-simulating or regenerating offers.
5. New free-agent history records include truthful `seasonNumber` / `age` / display labels; older thin records render “Age unavailable” instead of borrowing current age.
6. When the latest completed record is a free-agent period, the standings panel shows “No league fixtures during this period.” Historical `latestStanding` is preserved; a final club season that releases the player still shows its real table.

Gameplay unchanged: one season per action, no fabricated league, recruitment thresholds untouched, zero offers still valid.

## Follow-up repairs (review F01–F04)

| Finding | Repair |
| --- | --- |
| F01 checklist bypass | Removed forced overlay `hidden` / `onclick` completion fallback. Club season must finish via skip/Continue/scenario UI or fail on timeout. Page errors fail acceptance. Retirement requires `isRetired` **and** simulate disabled **and** both overlays closed. |
| F02 standings relabel | `renderStandings` classifies from the latest season record; FA periods get the no-fixtures empty state. |
| F03 thin age fallback | `appendFreeAgentSeasonCard` uses stored `season.age` or “Age unavailable”. |
| F04 empty market | New `empty-result` fixture (`careerId: free-agent-ui-empty-2`) and URL; Flow 1/2 assert genuine zero offers after review. |

## Changed files

| File | Purpose |
| --- | --- |
| `js/ui/seasonAnimation.js` | Free-agent recap dispatch, promise/error contract, final Continue await |
| `main.js` | In-flight guard, await presentation, recovery, idempotent history finish, fixtures incl. empty-result |
| `js/ui/rendering.js` | FA history cards, age fallback, standings no-fixtures for latest FA period |
| `js/simulation/contractLifecycle.js` | Truthful metadata on new free-agent period records |
| `js/simulation/freeAgentBrowserFixture.js` | Deterministic fixtures incl. `empty-result` / `FREE_AGENT_EMPTY_RESULT_CAREER_ID` |
| `index.html` / `style.css` | Free-agent recap section + styling |
| `qa/repro-free-agent-softlock.html` | Updated success criteria |
| `tests/freeAgentUiSoftlock.test.mjs` | Soft-lock + empty-result + age/standings regressions |
| `tests/helpers/minimalDom.mjs` | Minimal DOM shim (`dataset`, `innerHTML` clears children) |
| `scripts/browserFreeAgentSoftlock.mjs` | Soft-lock browser smoke |
| `scripts/browserFreeAgentChecklist.mjs` | Six-flow acceptance without overlay bypass; empty-result flows |

## Fixture entry points (Boris checklist)

```bash
python3 -m http.server 8000
```

| Checklist item | URL | Expected |
| --- | --- | --- |
| Genuine empty-result market | http://127.0.0.1:8000/?fixture=free-agent-empty-result | Free agent; two searches stay at 0 offers; search re-enabled without decline |
| Empty desk (offers may appear after search) | http://127.0.0.1:8000/?fixture=free-agent&mode=empty | Desk starts empty; market after search is not asserted empty |
| Offers ready | http://127.0.0.1:8000/?fixture=free-agent-offers | Pending offers, simulate disabled |
| Already signed | http://127.0.0.1:8000/?fixture=free-agent-signed | Club registered, ordinary next season |
| Age-41 retirement | http://127.0.0.1:8000/?fixture=free-agent-retire | Age 41; one search → age 42 retirement; both overlays close |
| Expiry club season | http://127.0.0.1:8000/?fixture=free-agent-expiry | Under contract; next club season uses ordinary playback |

Console: `window.__loadFreeAgentBrowserFixture({ mode: "empty-result" })`.  
Debug: `window.__getLiveCareerDebug()`.  
Standalone: http://127.0.0.1:8000/qa/repro-free-agent-softlock.html

## Commands run

```bash
node --test --test-reporter=tap \
  tests/contractLifecycle.test.mjs \
  tests/browserFlowSmoke.test.mjs \
  tests/careerFlowSmoke.test.mjs \
  tests/leagueSimulationDashboard.test.mjs \
  tests/simulationDashboardUi.test.mjs \
  tests/freeAgentUiSoftlock.test.mjs

node --test tests/*.test.mjs

python3 -m http.server 8000
# other terminal — system Chrome + playwright-core:
BASE_URL=http://127.0.0.1:8000 node scripts/browserFreeAgentChecklist.mjs
# optional: CHROME_PATH=/path/to/chrome
```

## Test results (follow-up revalidation)

| Suite | Result | Notes |
| --- | --- | --- |
| Focused existing + new | **30/30 pass** | All subtests executed; none skipped |
| Full `tests/*.test.mjs` | **69 pass, 1 fail** | Fail is baseline `playerAbility` only |
| Browser checklist | **PASS** | All six flows; `pageErrors: []` |

### Unrelated full-suite failure

`tests/playerAbility.test.mjs` fails alone on the original baseline (annual development cap / academy allowance). Not introduced by this branch; growth logic was not changed.

### Browser acceptance evidence (corrected harness)

| Flow | Outcome |
| --- | --- |
| 1 Genuine empty-result | age 27→28, history 1, offers 0, search enabled, FA label |
| 2 Second empty-result search | age →29, history 2, offers 0, no decline needed |
| 3 Double-click empty-result | one period / one history card |
| 4a Decline offers | no age/period advance; search restored |
| 4b Accept → club season | ordinary playback; overlay closed via UI; history 1; overview age matches; guard cleared; Eintracht Frankfurt |
| 5 Expiry → FA search | club season then FA recap on subsequent search |
| 6 Retirement | age 42, `isRetired`, simulate disabled, both overlays closed |

Screenshots: `qa/screenshots/checklist-free-agent/` (fresh final-run set).

Distinctions required by review:

- **Engine state committed** — seasons/age/totals asserted from `__getLiveCareerDebug`.
- **Presentation finished through real controls** — skip/Continue/scenario/retirement buttons only; no forced overlay hide.
- **Visible desk/history refreshed** — history card count and overview age match committed state; “No seasons yet” rejected after club season.
- **Unexpected browser errors absent** — soft page errors fail the run.
- **Tests executed vs skipped** — Node offer/signed fixtures hard-fail if they cannot establish state; no `assert.ok(true, "skipped…")`.

## Remaining limitations

- Browser acceptance needs system Chrome + locally installed `playwright-core`.
- Prolonged unemployment / offer frequency unchanged (out of scope).
- Awards / Europe / growth backlog untouched.
- `empty-result` identity is calibrated against current recruitment; if calibration drifts, replace with another explicit deterministic fixture rather than accepting offers.

## Handoff

Follow-up changes are on `fix/01-free-agent-ui-softlock` for independent sign-off. Do not merge or start the next backlog item from this session.
