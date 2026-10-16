# Continental result integrity repair

**Date:** 15 October 2026  
**Audited revision:** `1b93a21a6ef33d9a341958079a87c66745c4379a`  
**Scope:** Champions League / Europa League / Conference League shared continental machinery (also used by AFC / CONMEBOL / CAF / Concacaf callers)

## 1. Root causes removed

| Cause | What broke | Fix |
| --- | --- | --- |
| Greedy league-phase scheduler with `opponents+2` repair on MD `opponents+1` | P9/P10, MD9, unbalanced H/A | Round-robin factorization + exact home/away orientation; validate before publish |
| Batch `simulateEuropeanCampaign` then chronological re-sim of player matches | Viewer FT ≠ table / store | Prepare edition → play each fixture once on its date → project view from store |
| Shallow `reconcileCampaignWithPlayerMatches` | Patched `playerMatches` only | Continental path no longer uses reconcile; rebuild from committed fixtures |
| Unconditional `resolveKnockout` on every continental chrono slot | League draws → ET/pens; first legs decided as ties | Stage/tie metadata gates resolution; league + first legs stay regulation |
| Display-name / index match IDs without edition namespace | Cross-season collisions; unstored viewer IDs | Canonical IDs: `{competitionId}:{editionId}:{stage}:mdN:{home}:{away}` |
| Form/ledger keyed only by object `_formApplied` | Duplicate side effects on same identity | `world.formAppliedFixtures` Set + early return from played store records |
| `simulateKnockoutPath(..., startLabel: 'playoff')` ran to a final | Phantom KO fixtures / ledger | One-round playoff only; then real R16→Final |
| `resolveTwoLeggedTie` returned second-leg-relative `winnerSide` and dropped ET goals | Wrong tie winners; stale second-leg scores | First-leg-relative side; propagate ET into second-leg totals and aggregate |

## 2. Data flow (after)

```
prepareContinentalEdition  → schedule opening fixtures (status: scheduled)
        ↓
chronology continental_md / continental_fixture events (dated by stage rules)
        ↓
processContinentalMatchday / processContinentalFixture  → commit once
        ↓
advanceContinentalStage  → playoff (one round) → R16 → … → Final
        ↓
buildContinentalCampaignView  → UI / awards / season summary
```

`simulateContinentalCampaign` drains the same lifecycle synchronously. The viewer reads `playerMatches` and `leaguePhase.table` projected from the same committed fixtures.

### Identity / lifecycle / checkpoint

- **IDs:** `uefa-europa-league:2026-uefa-europa-league:league:md2:<homeId>:<awayId>` (and analogous KO/tie/leg forms; AFC includes `reg:west` / `reg:east`).
- **Edition state:** persisted on the competition-store edition as `lifecycle` (fixtures, stages, played IDs, frozen tables).
- **Checkpoint:** version **3** adds `europeEdition` alongside `europePlan`. Resume reloads from checkpoint / store; completed fixtures are not re-simulated.

### Approximations (documented)

- League-phase draw does **not** enforce UEFA pots or association restrictions; structural counts are unconditional.
- UEFA ranking uses points → GD → GF → away goals → wins → away wins → opponents’ pts/GD/GF → club `coefficient` field (falls back to overall when no dedicated coefficient exists). Not a claim of full regulatory equivalence (no disciplinary points feed yet).
- Copa Sudamericana playoff proxies for Libertadores thirds remain a simulation-policy stand-in (see engine comments).

### Legacy saves

Snapshots from the audited revision may contain colliding IDs, MD9 extras, or viewer scores that never matched the store. Those careers are **not** rewritten. New editions use the corrected lifecycle. Continental reconcile is retained only as a legacy/international adapter and is not the normal continental gameplay path.

## 3. Before / after reproduction

### Table vs viewer (chrono, seed 3, Red Star, Europa League)

| | P | W | D | L | Pts | Max MD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Before** table | 8 | 1 | 2 | 5 | 5 | (phase had MD9 fixtures) |
| **Before** viewer | 8 | 4 | 0 | 4 | 12 | MD9 present, MD5 missing |
| **After** table | 8 | 4 | 2 | 2 | 14 | 8 |
| **After** viewer | 8 | 4 | 2 | 2 | 14 | 8 |

Agreement: identical tallies; every viewer match ID present in `world.matches` with the same score.

### Scheduler (36 clubs, 8 opponents, seeds 1–1000)

| | Invalid match counts / extra MD | Invalid H/A |
| --- | ---: | ---: |
| **Before** (audit sweep) | 589/1000 | 1000/1000 |
| **After** | 0/1000 | 0/1000 |

UECL (6 opponents): also 0/1000 failures.

### Two-leg ET (Red Star 1–0, Čukarički 1–0, `createRng(4)`)

| | `winnerSide` | Second-leg goals after ET |
| --- | --- | --- |
| **Before** | `home` (wrong; second-leg orientation) | still 1–0 regulation |
| **After** | `away` (first-leg-relative) | 2–0 / matchHomeGoals 2; aggregate `1-2` |

## 4. Tests run

```bash
node --test tests/continentalIntegrity.test.mjs
node --test tests/competitionsFormats.test.mjs
node --test tests/contractLifecycle.test.mjs tests/individualAwards.test.mjs tests/playerProgressionV3.test.mjs
node tests/chronologicalSeason.test.mjs
node tests/leagueSimulationDashboard.test.mjs
node tests/simulationDashboardUi.test.mjs
node tests/loanPlayingLeague.test.mjs
node tests/crossLeagueCareer.test.mjs
node tests/browserFlowSmoke.test.mjs
node tests/careerFlowSmoke.test.mjs
```

All listed suites **passed**. New coverage in `tests/continentalIntegrity.test.mjs`:

- 1000-seed UCL/UEL and UECL schedule invariants  
- Controlled four-win injection → P8 W4 D2 L2 Pts14 (+ mirrored accounting)  
- Chronology table ≡ viewer ≡ store  
- Idempotent reprocess; disjoint edition IDs  
- Playoff-only round; ET orientation audit case; JSON round-trip metadata  

## 5. Browser / UI evidence

Engine-level controlled injection and chronology agreement establish W4/D2/L2/Pts14 and store-backed FT scores. The season animation UI still consumes `europeanCampaign.playerMatches` and `leaguePhase.table`; both now derive from the same committed fixtures, so reveal/skip paths cannot diverge by re-simulation. Interactive browser DOM capture of the injected four-win script was not separately automated in this pass; use the integrity test’s injected campaign or a Red Star Europa career after this revision for visual confirmation.

## 6. Files changed (primary)

| File | Role |
| --- | --- |
| `js/simulation/continentalSchedule.js` | Validated scheduler + IDs + MD dates |
| `js/simulation/continentalTable.js` | Pure table projection + UEFA-style sort |
| `js/simulation/continentalTournament.js` | Edition lifecycle (prepare/process/advance/view) |
| `js/simulation/continentalChronology.js` | Chronology bridge |
| `js/simulation/chronologicalSeason.js` | Dated play-once continental events; checkpoint v3 |
| `js/simulation/europeanCompetition.js` | Re-exports lifecycle APIs |
| `js/simulation/matchEngine.js` | Two-leg orientation + score propagation |
| `js/simulation/worldState.js` | Fixture-identity form/ledger idempotency |
| `tests/continentalIntegrity.test.mjs` | New regressions |
| `tests/competitionsFormats.test.mjs` | Exact P8 / 144 / no MD9 invariants |

## 7. Remaining limitations

- Full pot/association UEFA draw not implemented (structural schedule only).  
- Disciplinary tie-break criterion not fed from match cards.  
- Legacy inconsistent editions are preserved as-is rather than auto-healed.  
- International tournaments still use shallow reconcile for player re-sims (out of continental acceptance scope; shared helper inspected and left for that caller).
