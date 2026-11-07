# Fix 03 — League membership after promotion / relegation

**BASE_COMMIT:** `f937a7092ecf658d4655d2112b4bed45809a1d1f`  
**Branch:** `fix/03-league-membership`

## Root cause

`applyDivisionMovement` exchanged only the player’s club, so England became 21/23 or 19/25. Fixture generators (`chronologicalSeason`, `leagueFixtures`, `destinationSchedule`) and `allSeniorClubs` still read static `LEAGUES.clubs`, so moved clubs were appended or missing from schedules.

## Authority

- Live roster: `world.leagueMemberships`
- Edition freeze: `world.leagueEditionRosters` (`leagueId::seasonYear`)
- Idempotent pair exchange: `world.membershipTransitions`
- Shared exchange counts for the five modeled pairs (England/Spain 3; Germany/Italy/France 2)

## Key modules

- `js/simulation/leagueMembership.js` — resolve/freeze/complete/commit
- Wired into chrono, legacy fixtures, destination schedule, edition adapter, senior catalog, season boundary, dashboard seeding
- Persistence via `serializeWorldState` / `deserializeWorldState`

## QA

- `node tests/leagueMembershipTransitions.test.mjs` — PASS
- Required regression suites — PASS
- Full suite — only unchanged baseline `playerAbility` growth-cap failure
- `scripts/browserMembershipChecklist.mjs` — all 7 cases PASS
