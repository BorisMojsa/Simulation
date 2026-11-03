# Fix 09 audit — earned continental qualification

**Base:** `984495e4c12df0c2dd1c84d124bc4cb743a0f63e` (`fix/08-user-rival-performance-individual-awards`)  
**Branch:** `fix/09-earned-continental-qualification`  
**Workspace:** `/Users/mojsa/Desktop/Simulation/.worktrees/fix09`  
**Runtime:** Node v22.19.0  
**Baseline controls:** `qa/fix09-runs/baseline/constructed-controls.json`

## Confirmed defects (executable)

Seed **91** constructed controls at the pinned base:

| Control | Observed |
| --- | --- |
| Arsenal P1 playerRow carried to Brentford (same league ID) | `position 1`, `League Champions`, edition attaches **Brentford** to Champions League |
| `world.standings` Brentford P17 ignored; OVR 60→90 | `null` → position `1` / Champions League |
| Re-prepare same CL edition for new focus after MD1 | same `editionId`, **fieldChanged true**, focus becomes Brentford, committed matches retained |
| Invalid ranks `{}` / `0` / `-1` / `0.5` Brazil & Mexico | Copa Libertadores / CONCACAF Champions Cup |

Existing smoke (`competitionsFormats` + `continentalIntegrity` + `clubOwnershipTransfers`): **18 pass, exit 0** — does not cover these controls.

## Answers

### 1. Completed domestic edition identity

- Chronological completion returns `status: "complete"` with `table` from `buildTable(records)` (`chronologicalSeason.js` finalize paths ~987 and ~2041).
- All club rows live on that table; `player.latestStanding` keeps a **player-facing** projection (`seasonSimulator.js` ~926) with `leagueId`, `table`, `playerRow`, `seasonNumber`/`seasonId`.
- `world.standings` is written by league key only (no edition year) and is **not** read for entry.
- `world.qualification` exists in create/serialize/deserialize and has **no production writers**.
- Domestic `leagueEditionAdapter` stores matches but does not mark final-table completion.
- Live/partial tables: in-season `records`, January pause checkpoints, destination past sims — none are finalization.

### 2. Year / calendar mapping

- Domestic and continental prep share `seasonStartYear = (player.startYear||2026) + seasonIndex`.
- Continental edition id: `` `${seasonYear}-${competitionId}` `` (`continentalSchedule.js`).
- Prior finish used at the **start** of season Y is the completed domestic edition **Y−1** (bootstrap for the first career year).
- Development `season-${n}`, academy narrative years, and free-agent waits are **not** competition edition IDs.

### 3. Club changes before entry resolve

Entry resolves at season start via `preSeasonContinentalStanding` → `prepareSeasonContinental`. Mid-season moves attach to an already prepared edition.

Playing tip changes: permanent transfer, loan, loan return, release, academy graduation (`dealPipeline`, `loanMarket`, `contractLifecycle`, academy paths). Employment tip retained separately on loans. `latestStanding` can still describe the **previous** club after a move or free-agent gap.

### 4. Destination / incomplete origin

`reconcileAfterClubChange` builds a fresh destination schedule and background-sims past fixtures for form only — no earned destination prior-season table. Leaving mid-season drops remaining origin events; origin half-tables are not treated as complete evidence.

### 5. Entry grant paths

- Initial chrono prep (`simulateChronologicalSeason` ~412).
- Resume restores checkpoint / world edition — does not re-qualify.
- Direct `simulateContinentalCampaign` / `simulateEuropeanCampaign`.
- Destination attachment schedules remaining eligible fixtures only.
- UI restore consumes `season.europeanCampaign` / store lifecycle.

### 6. Edition existence / focus overwrite

`prepareContinentalEdition` reuses only when `existing.playerClubId ===` current focus; otherwise rebuilds and `persistEdition` overwrites participants/lifecycle for the same `(competitionId, editionId)`.

### 7. Non-qualification vs missing

Empty qualification label + out-of-band position means DNQ **only when a real finish exists**. Missing `playerRow.position` falls through to OVR bands. No explicit stored non-qualification object. Empty/`{}` standing can still grant CONMEBOL/CONCACAF via `Number(position)||0` and `pos <= 4`.

### 8. Legacy snapshots

Recoverable: modern edition lifecycle rows; `latestStanding` with clubId + leagueId + full table + season identity. Ambiguous: truncated tables, missing club/year, store rows without lifecycle (reload null → recreate risk).

### 9. Background inventory

`clubsFromConfederation` + `sampleField` OVR sampling. Focus club forced in; peers are synthetic approximations. Nominal UEFA field 36 exceeds modeled association slot totals — document and do not relabel fills as earned.

## Implementation plan

1. Add `js/simulation/earnedQualification.js`: edition-scoped registry on `world.qualification`, strict rank validation, club+year resolver, deterministic bootstrap, legacy migration.
2. Harden `continentalCompetitionForStanding` (reject invalid ranks; preserve slot bands; fix France comment).
3. Replace OVR/`playerRow` shortcut in `preSeasonContinentalStanding` with resolver against **playing club**.
4. Commit complete domestic tables at both chrono finalize paths (and seasonSimulator standing assembly).
5. Freeze `prepareContinentalEdition`: reuse world edition regardless of focus; attach focus only when in field + registration; prefer earned peers when building new fields; mark synthetic fills.
6. Keep registration policy separate from sporting qualification.
7. Tests F01–F25, QA exporter/oracle, browser B01–B09, package script.

## Exclusions honored

No team-strength retune, growth/OVR caps, award scoring changes, real-world access-list rewrite, new competitions, or national-tournament changes.
