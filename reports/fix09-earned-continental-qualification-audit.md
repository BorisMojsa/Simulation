# Fix 09 audit — 0d7664c ReReview follow-up

## Scope

Continue Fix 09 on `fix/09-earned-continental-qualification` from `0d7664c`. Do not open Fix 10. Preserve R6 and Premier League controls.

## Oracle completeness / campaign identity

| Control | Before | After |
| --- | --- | --- |
| 1 of 380 source results | accepted | `incomplete-source-results` |
| 379 of 380 | accepted | `incomplete-source-results` |
| Full 380 + per-club coverage | accepted | accepted |
| Campaign `editionId` `1900-…` | accepted | `wrong-campaign-edition-year` |

## Paired base/final

Isolated `git worktree` at `984495e` vs current tip. Shared archived inputs under `qa/fixtures/paired-controls/inputs/`. Final invariants pass; base observations are not required to match final.

## Browser

| Case | Evidence |
| --- | --- |
| B04 reverse/cross | Pre-sim tables; summer loans; borrower in field initially and at desk; dated continental observations; full snapshots |
| B06 | Branch A live from pause; Branch B fresh restore; dual-restore equal; live market divergence recorded when present |
