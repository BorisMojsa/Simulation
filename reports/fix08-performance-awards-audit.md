# Fix 08 audit — performance comparability and awards

Prepared 2026-10-30. Branch: `fix/08-user-rival-performance-individual-awards`.  
Accepted base: `52dc6014f0aa6ba372e8ebc453943e8e3023b7d1`. Node at start: `v22.19.0` (reviewer pin was v24.22.1).

## Starting record

| Item | Value |
| --- | --- |
| Worktree | `/Users/mojsa/Desktop/Simulation/.worktrees/fix08` |
| Branch | `fix/08-user-rival-performance-individual-awards` |
| HEAD / remote base | `52dc6014f0aa6ba372e8ebc453943e8e3023b7d1` (ancestor OK) |
| Status at branch create | clean tracked tree |
| Unrelated Fix 07 QA | left in `.worktrees/fix07` (not staged here) |

## Reproduced witnesses (Appendix A)

Saved: `qa/fix08-runs/baseline/appendix-a-scope.json`.

| Run | Combined rating | League goals | League awards |
| --- | ---: | ---: | --- |
| leagueOnly | 6.3 | 10 | none |
| cupRatingOnly (6×9.8, 0 goals) | 6.883… | 10 | TOTS selected rank 3 |
| cupOutput (6 apps, 30 goals) | 6.883… | 10 | TOTS + POTS + Young + Rookie **won** |

Confirms B/C: cup rating contaminates league TOTS; cup goals contaminate league POTS/Young/Rookie via whole-season entry.

## Findings (with call sites)

### 1. Ledger → evidence → awards

- Match day: `processPlayerMatchDay` → ledger observation (`playerMatchDay.js`).
- Season: `seasonSimulator` aggregates ledger → `buildSeasonEvidence` → `evaluateSeasonAwards` → recognition → development once.
- `scopeLinesFromMatches` (`seasonEvidence.js`) builds `byEdition` with minutes/G/A/CS but **no scoped rating**.
- Top-level `minutesWeightedRating` is whole-season.

### 2. Rival model

- `generateTeamRoster`: minutes = `round(played*90*u)`, matches = `round(played*u*0.95)` → minutes often > apps×90 (issue E).
- Rating: start **6.5** + teamQ/output/talent/noise; user match rating starts **6.0** (`computeMatchRating`).
- `adjustUserTeam` caps goals/assists **after** rating computed → stale ratings (issue F).
- `selectRivalIds` keeps top contenders only; no population moments persisted for standardization.

### 3. Award scope bugs

- `userLeagueEntry.rating = evidence.minutesWeightedRating` (whole season) while G/A/minutes are league (`individualAwards.js` ~747–762).
- `userSeasonEntry` inflates G/A/minutes with whole-season totals for POTS/Young/Rookie/World against **league-only** rivals (~858–907).
- World field: 12 Gaussian scores mean 4.4 SD 0.9 (`ensureWorldAwardField`) — units must be reconciled with `scoreSeasonLine`.

### 4. Substitute exposure

- `buildGoalEvents` floors share denominator at 50% of team goals → short subs double-penalized vs per-90 ideal (issue D).

### 5. Persistence

- `FIELD_VERSION = 1` on `player.awardFields[editionId]`. Reuse when version matches.
- Exact-once season finalize in `seasonSimulator` (`lastProcessedSeasonId`).

## Implementation plan

1. Add edition/scope **ratedMinutes / ratingSum / rating** to evidence lines; aggregate only known ratings.
2. League award candidates use **league-scoped** rating and output only. World may use documented whole-season line separately.
3. Fix rival opportunity conservation; recompute ratings after user-team caps; persist pre-compression reference moments.
4. Remove 0.5 goal-share floor; continuous goals-while-playing denom.
5. Align rival rating center with user baseline (6.0) without changing team xG / growth formulas.
6. World benchmark: express synthetic candidates in `scoreSeasonLine` units with documented GK/DEF/MID/FWD treatment.
7. Focused tests F01–F20, parity cohorts, engine cohorts, browser B01–B07, package ZIP.

Out of scope (documented if touched only by observation): Fix 09–14, team strength, growth retune.
