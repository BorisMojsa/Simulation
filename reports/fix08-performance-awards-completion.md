# Fix 08 completion report — user/rival performance and individual awards

Branch: `fix/08-user-rival-performance-individual-awards`  
Accepted base: `52dc6014f0aa6ba372e8ebc453943e8e3023b7d1`

## What changed

### Scoped evidence (`seasonEvidence.js`)
- Edition/scope lines now carry `ratedMinutes`, `ratingSum`, and minutes-weighted `rating`.
- Unknown ratings stay unknown (not zero). Zero-minute rows remain non-appearances.

### League award candidates (`individualAwards.js`)
- League TOTS / POTS / Young / Rookie / Boot / Glove use **league-edition** goals/assists/minutes/**rating**.
- Cup/continental/international no longer inflate league candidate lines (Appendix A equal across three runs).
- World Player of the Year uses an explicit whole-season line in `scoreSeasonLine` units; synthetic world candidates are scored with the same contract.
- Rival opportunity: appearances first; minutes ≤ apps×90; CS ≤ apps; ratings recomputed after user-team caps.
- Full-population `referenceMoments` persisted before compact retention.
- Shared rating baseline `6.0` with user `computeMatchRating`; rival coefficients aligned for center parity.
- Field version 2; version-1 fields remain reusable for completed seasons.

### Match attribution (`matchEngine.js`)
- Removed the 50% team-goal floor on the goals-while-playing denominator so short substitutes are not double-penalized.

### Tests / harnesses
- `tests/userRivalPerformanceAwards.test.mjs` (F01–F05, F08–F13, F15–F16, F20+)
- `scripts/qaUserRivalPerformanceAwards.mjs`
- `scripts/qaFix08Parity.mjs` (200 train + 200 holdout seeds per cell)
- `scripts/qaFix08EngineCohort.mjs` (+ dedicated earned witnesses)
- `scripts/browserUserRivalPerformanceAwardsChecklist.mjs`

### Fixture note
- Fix 07 F9/F11 boundary facade tests retargeted from seed 707 → **703** after intentional attribution change (invariant unchanged).

## Known limitations
- No full NPC database; rival fields remain approximate.
- World field is a bounded synthetic approximation (documented).
- Fix 11 overall/growth calibration is out of scope; downstream development may shift with performance evidence.
- Minimal engine cohort is 8×3; expand with `FIX08_COHORT_FULL=1` for broader coverage.
- Some F-ids (F06/F07/F14/F17–F19) remain partially covered by existing suites / dedicated witnesses rather than exhaustive new cases.
