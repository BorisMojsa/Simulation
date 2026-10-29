# Fix 06: Injury exposure used for development — completion report

Prepared 2026-10-29 (America/Chicago).

## Identity

| Item | Value |
| --- | --- |
| Branch | `fix/06-injury-exposure-development` |
| Base (accepted Fix 05 tip) | `49d3929c7da809fc42c61a0d3126080ceeb0a8f3` |
| Predecessor ancestry | Verified: `git merge-base --is-ancestor 49d3929… HEAD` |
| Worktree | `/Users/mojsa/Desktop/Simulation-fix06` (isolated from dirty Fix 05 checkout) |

Final commit SHA and remote verification are recorded in the review package `manifest.json` after push (not embedded here before commit).

## Problem

Completed senior development called `buildSeasonEvidence` with bare `seasonDays: 300` and no dated window. Historical injury durations then reduced later seasons' healthy-training credit (often to the 0.15 floor). Separately, `estimateHealthyTrainingDetail` preferred late `recoveredDay` observation timestamps over availability return boundaries, and unscoped duration-only history rows could charge every subsequent year.

## Decisions

### Development period (June→June)

Authoritative helper: `resolveDevelopmentPeriod(player, opts)` in `js/simulation/seasonEvidence.js`.

```
Y = (player.startYear || 2026) + seasonIndex
periodStart = Y-06-01
periodEndExclusive = (Y + 1)-06-01
periodDays = toDay(end) - toDay(start)   # leap years honored via UTC day math
```

Rationale: covers summer internationals through May club football; adjacent non-overlapping annual windows; independent of selection/minutes.

### Availability return boundary

Estimator uses `availabilityReturnDay` → `expectedReturnDay` → `start+duration`. A later `recoveredDay` does not extend unavailable time. `advanceHealth` now also stores `availabilityReturnDay` on new history rows while preserving `recoveredDay` as the observation timestamp.

### Legacy / unknown rows

With a dated window, duration-only historical rows are excluded from missed days, counted as unknown, and keep `partial: true`. Undated **active** injuries retain the bounded duration-or-30 compatibility charge. Standalone no-window callers remain partial; complete senior production always supplies a real window (`requireDatedHealthWindow: true`).

### Persistence

Saved `seasonEvidence` now includes `developmentPeriod`, `season` endpoints, raw/applied healthy fractions, method/partial, union days, contributing/excluded event IDs, and clipped intervals. Checkpoint objects carry `developmentPeriod` for pause/resume; missing legacy fields reconstruct deterministically from `seasonIndex` + `seasonStartYear`.

## Production changes

- `js/simulation/seasonEvidence.js` — period helper; rewritten interval estimator; richer evidence
- `js/simulation/seasonSimulator.js` — wire period into evidence/development; persist evidence; set `lastProcessedSeasonId` on senior completion
- `js/simulation/chronologicalSeason.js` — checkpoint `developmentPeriod`
- `js/simulation/playerHealth.js` — store `availabilityReturnDay` on recovery
- `main.js` — expose period/health fields on `__getLiveCareerDebug().lastSeason` for browser QA

## Baseline reproduction (before fix, at `49d3929`)

| Probe | Result |
| --- | --- |
| `buildSeasonEvidence` with only `seasonDays: 300` + old `[100,400)` injury | `healthyTrainingFraction: 0.15`, `injuredDays: 300`, `method: history-durations` |
| Same with `seasonStartDay:1000, seasonEndDay:1300` | `healthyTrainingFraction: 1`, `injuredDays: 0` |
| Unscoped `{durationDays:300}` inside `[1000,1300)` | incorrectly charged 300 days |
| Documented `playerAbility.test.mjs` failures | annual-cap learning `8.693…`; academy shared-allowance assertion |

## QA results (final packaged code)

| Gate | Result |
| --- | --- |
| `node tests/injuryDevelopmentExposure.test.mjs` | **35/35 PASS** |
| `node scripts/qaInjuryDevelopmentExposure.mjs` | **PASS** — 24 ordinary + 5 dedicated records; all 7 invariants |
| Required regression list (excl. ability) | **PASS** |
| `node tests/playerAbility.test.mjs` | **2 documented pre-existing FAILs** (unchanged assertions) |
| `node --test tests/*.test.mjs` | **73 pass / 1 fail** (the ability file) |
| `scripts/qaMatchParticipationEvidence.mjs` | **PASS** |
| Browser Fix 06 checklist B01–B04 | **PASS** |
| Browser Fix 05 checklist (incl. `live-et-pens-season-continue`) | **PASS** |

### Seed note

Injury-free control for old-history integration: ST seed **2**, GK seed **3** (`careerId fix06-${seed}-${position}`). Search range 1..5000 recorded in focused test case JSON.

## Re-review follow-up (R1–R5)

Addressed against independent review of `fe58bcab218a4ac089fa015da6a151ba54c8a7a7`:

| ID | Fix |
| --- | --- |
| R1 | Undated-active fallback only accepts finite **positive** durations; invalid/negative durations are excluded and cannot cancel known union days. |
| R2 | Duplicate-event selection prefers a usable dated interval over an incomplete copy; active status only breaks ties among equally usable copies. |
| R3 | `availabilityReturnDayOf` honors `expectedReturnDate` / `availabilityReturnDate` before falling back to late `recoveredDay`. |
| R4 | Pause helpers resolve senior scenarios via `applySeniorScenarioPolicy(..., "balanced")` (same as `autoDecisionPolicy: "stay"`). Matched-policy twins require period/health/match inputs/breakdown/attributes equality. Focused snapshot test uses `getWorldState()` + restored RNG. Legacy checkpoint test strips `developmentPeriod` from a real pause, serializes/restores, and completes via `simulateSeason`. Durable-damage test uses configured `severe` + seed 6 with nonzero tracked damage. |
| R5 | Fresh Fix 05 browser report packaged from the post-fix working checkout (not the Git-exported historical copy). |

Audit oracle independently implements the same return-date and nonnegative-duration rules and uses those endpoints for occupancy (production helper is only cross-checked).

## Limitations

- Browser B01 may still accumulate *new* in-season injuries under UI pause-for-decisions; assertions reconcile against the live union oracle rather than requiring zero new injuries in the browser path. A separate engine control (seed 2) proves exact 100% credit with old history and no new overlap.
- Summer-international audit case injects a dated June/July injury as a controlled interval/window integration test; it does not claim a naturally sampled international injury event.
- The previously reported PR2 pause/restore divergence was a **mismatched scenario policy** in the harness (cleared pending scenes vs balanced auto-policy). Under matched balanced policy the twins agree; that limitation is withdrawn.

## Not done (by design)

No merge/deploy. No Fix 07. No growth retune. No injury-rate changes. No save-system product feature.
