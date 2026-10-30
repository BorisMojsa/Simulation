# Fix 08 completion report — user/rival performance and individual awards

Branch: `fix/08-user-rival-performance-individual-awards`  
Accepted base: `52dc6014f0aa6ba372e8ebc453943e8e3023b7d1`

## ReReview status

Closes ChatGPT ReReview findings R1–R7 against commit `29e79d9` while remaining on Fix 08. See packaged `reports/r1-r7-closure.md`.

## What changed

### League award candidates (`individualAwards.js`)
- League TOTS / POTS / Young / Rookie / Boot / Glove use **league-edition** goals/assists/minutes/**rating**.
- Category-aware `selectRivalIds` retention (eligibility + metric), post-adjustment selection, optional diagnostic population.
- Field lifecycle: `stage` + `inputFingerprint`; unfinished caches refresh; completed history preserved.
- `decisionTrace` covers every award category including rejected/ineligible outcomes.
- Provenance flags: `tableApproximated` / `playerStatsApproximated`.
- World Player of the Year uses an explicit whole-season line with league/competition gates.

### Match attribution (`matchEngine.js`)
- Removed team-goal share floors (`0.5` and remaining `0.35`) so duration is not applied twice for short appearances.
- `buildGoalEvents` exported for controlled regressions.

### Tests / harnesses
- `tests/userRivalPerformanceAwards.test.mjs` — F-suite + R1–R3 regressions; meaningful F13/F15/F16/F20.
- `scripts/qaFix08Parity.mjs` — matched season-equivalent cells, tolerances enforced, nonzero exit on fail.
- `scripts/qaFix08EngineCohort.mjs` — default **48×3** across ≥3 leagues; decision traces; dedicated witnesses.
- `scripts/browserUserRivalPerformanceAwardsChecklist.mjs` — real Continue journeys via `__exportCareerSnapshot`.
- Base/final cohort comparison under `qa/fix08-runs/comparison/`.

## Known limitations
- Synthetic rival field (no full NPC DB).
- World field is a bounded synthetic approximation (documented).
- Fix 09–14 / growth / team xG / selection remain out of scope.
- Full Node suite still exits 1 on the two documented ability assertions only.
