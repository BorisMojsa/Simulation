# Fix 09 completion — ReReview repair (0d7664c follow-up)

## Verdict

READY FOR REVIEW (ReReview of 0d7664c)

## Identities

- Branch: `fix/09-earned-continental-qualification`
- Accepted predecessor: `984495e4c12df0c2dd1c84d124bc4cb743a0f63e`
- Previous reviewed tip: `0d7664ca5a1abff9f12e7a7e238fce4c3e92d5c1`

## ReReview repairs (0d7664c remaining)

| ID | Repair |
| --- | --- |
| R4 coverage | `simulated-complete` requires full schedule fixture count + per-club coverage; 1/380 and 379/380 fail |
| R4 campaign | Target-participation binds `europeEditionId` / season year / competition id to the source→target pair and world edition |
| R4 paired | Real worktree base `984495e` vs tip workers; shared input hashes; RNG after restore; base failure expected |
| R5 B06 | Live continuation vs fresh restore; dual-restore full equality; live market loan-offer divergence recorded honestly |
| R5 B04 | Pre-sim tables; summer reverse/cross loans; borrower field + dated observations; full snapshots |

## Gates

- Focused + regression: 87/87 PASS
- Cohort 14×3: 42/42, 0 oracle violations; corruption PASS
- Browser B01–B09: PASS (`requiredComplete`)
- Full suite: 164 pass / 1 failed file — only the two established `playerAbility` assertions

## Allowed failures

Exactly the two documented `playerAbility` assertions from Fix 08. No injury ambient claim.

Live-vs-restored B06 may still diverge on post-season development-loan offer clubs/ledgers (same pattern as prior tips). Dual-restore remains fully equal; divergence is exported under `B06-live-market-divergence.json`.
