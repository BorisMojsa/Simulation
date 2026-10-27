# Fix 01: Free-agent UI soft-lock — completion report

## Branch / baseline

- **Working branch:** `fix/01-free-agent-ui-softlock`
- **Starting commit:** `50fd6cfb9d614bd10da0f4e16a0a40df0bd601d2` (`main`, audited baseline)
- **Not pushed.** Local review only.

## Confirmed cause

`simulateSeason` correctly returns a free-agent payload (`freeAgent: true`, period record, no `league` / `standings`). `showSeasonAnimation` → `animateSeasonSequence` required league data, logged `Missing required season data`, opened `#season-animation-overlay`, and never wired Continue / `onContinue`. The career desk stayed trapped.

## Final behavior

1. Explicit free-agent results take a dedicated recap path **before** league validation (classified by result flags, not current club state).
2. Compact “Free-agent period complete” recap + enabled Continue; match/dashboard/award phases stay hidden.
3. Continue closes the overlay once, redraws history authoritatively, regenerates desk controls, and syncs the next action via `selectNextCareerAction`.
4. Async presentation returns a handled promise; missing club-season data and render failures recover the desk without re-simulating or regenerating offers.
5. New free-agent history records include truthful `seasonNumber` / `age` / display labels; older thin records render safely without `undefined` / `NaN` / fake `0.00` ratings.

Gameplay unchanged: one season per action, no fabricated league, recruitment thresholds untouched, zero offers still valid.

## Changed files

| File | Purpose |
| --- | --- |
| `js/ui/seasonAnimation.js` | Free-agent recap dispatch, promise/error contract, final Continue await |
| `main.js` | In-flight guard, await presentation, recovery, idempotent history finish, fixtures |
| `js/ui/rendering.js` | Free-agent history card branch + competitions empty copy |
| `js/simulation/contractLifecycle.js` | Truthful metadata on new free-agent period records |
| `js/simulation/freeAgentBrowserFixture.js` | Deterministic released-player fixtures |
| `index.html` / `style.css` | Free-agent recap section + styling |
| `qa/repro-free-agent-softlock.html` | Updated success criteria (recap + Continue, not “visible overlay = lock”) |
| `tests/freeAgentUiSoftlock.test.mjs` | Node regressions against production presentation path |
| `tests/helpers/minimalDom.mjs` | Minimal DOM shim for presentation tests |
| `scripts/browserFreeAgentSoftlock.mjs` | Real Chrome acceptance script |

## Fixture entry points (Boris checklist)

Serve the repo root, then open:

```bash
python3 -m http.server 8000
```

| Checklist item | URL / command | Expected |
| --- | --- | --- |
| Empty free agent desk | http://127.0.0.1:8000/?fixture=free-agent&mode=empty | Free agent / No club, wage 0, button “Train / search as free agent” |
| Offers ready | http://127.0.0.1:8000/?fixture=free-agent-offers | Pending offers, simulate disabled |
| Already signed | http://127.0.0.1:8000/?fixture=free-agent-signed | Club registered, ordinary next season |
| Age-41 retirement | http://127.0.0.1:8000/?fixture=free-agent-retire | Age 41; one search → age 42 retirement path, no stuck recap |
| Expiry club season | http://127.0.0.1:8000/?fixture=free-agent-expiry | Under contract; next club season uses ordinary playback |

Or in the console after load: `window.__loadFreeAgentBrowserFixture({ mode: "empty" })`.

Debug snapshot: `window.__getLiveCareerDebug()`.

Standalone animation contract page: http://127.0.0.1:8000/qa/repro-free-agent-softlock.html

## Commands run

```bash
node --test tests/freeAgentUiSoftlock.test.mjs

node --test --test-reporter=tap \
  tests/contractLifecycle.test.mjs \
  tests/browserFlowSmoke.test.mjs \
  tests/careerFlowSmoke.test.mjs \
  tests/leagueSimulationDashboard.test.mjs \
  tests/simulationDashboardUi.test.mjs \
  tests/freeAgentUiSoftlock.test.mjs

node --test tests/*.test.mjs

# Browser (requires system Chrome + playwright-core)
npm install --no-save playwright-core
node scripts/browserFreeAgentSoftlock.mjs
```

## Test results

| Suite | Result |
| --- | --- |
| `tests/freeAgentUiSoftlock.test.mjs` | **12/12 pass** |
| Focused existing + new (above) | **29/29 pass** |
| Full `tests/*.test.mjs` | **68 pass, 1 fail** |
| Real browser (`scripts/browserFreeAgentSoftlock.mjs`) | **PASS** |

### Unrelated full-suite failure

`tests/playerAbility.test.mjs` fails **alone** on this baseline (`development: annual cap…`, `academy growth…`). Not introduced by this branch; no player-ability / growth files were changed.

### Real browser

Yes — Google Chrome was launched via Playwright Core against `http://127.0.0.1:8000`.

Automated checklist (`scripts/browserFreeAgentChecklist.mjs`) **PASS** for all six Boris acceptance flows:

1. Empty free agent → recap → Continue → age +1, history +1, wage/apps unchanged  
2. Search again 3× → readable history, no `undefined`/`NaN`  
3. Double-click search/Continue → still one period / one history card  
4. Offers → decline (no time advance) → restart → accept → Bundesliga club season (not FA recap)  
5. Expiry fixture → club season matches/results → later Train/search shows FA recap only then  
6. Age-41 → 42 retirement, no stuck overlay  

Page errors / unhandled rejections: none.

## Before / after trace (empty free-agent action)

| Field | Before click | After engine (before Continue) | After Continue |
| --- | --- | --- | --- |
| Age | 27 | 28 | 28 |
| Period count | 0 | 1 | 1 |
| Career matches/goals/assists/CS | 0 | 0 | 0 |
| Wage | 0 | 0 | 0 |
| Pending offers | 0 | market-dependent (0 or more) | unchanged until declined/accepted |
| Completion count | 0 | 0 (recap waiting) | 1 |
| Overlay | hidden | visible free-agent recap | hidden |
| Next action | free-agent / canSimulate | blocked while overlay open | offers → resolve-offers; else free-agent |

## Contract-expiry / age-42 outcomes

- **Result classification:** a completed club season with league data is never treated as a free-agent recap, even if the player is released afterward.
- **Age 41 → search:** advances to 42; `maybeAutoRetire()` takes the retirement path; free-agent recap is not left open; simulation stays disabled when retired.

## Remaining limitations

- Browser acceptance uses system Chrome + locally installed `playwright-core` (`node_modules/` already gitignored). Sandboxed CI without Chrome will skip this until those prerequisites exist.
- Prolonged unemployment / offer frequency is unchanged (out of scope).
- Awards / Europe / growth backlog items are untouched.

## Handoff

Ready for Boris local review and push. Independent sign-off should compare the pushed commit against `50fd6cfb…` using this report and the fixture URLs above. Do not merge from this agent session.
