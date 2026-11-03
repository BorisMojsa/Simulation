# Fix 09 completion — ReReview repair (6f2c43e follow-up)

## Verdict

READY FOR REVIEW (ReReview of 6f2c43e)

## Identities

- Branch: `fix/09-earned-continental-qualification`
- Accepted predecessor: `984495e4c12df0c2dd1c84d124bc4cb743a0f63e`
- Previous reviewed tip: `6f2c43e7e280af58e16ac85c1ce109b87f2e5f83`

## ReReview repairs (6f2c43e remaining)

| ID | Repair |
| --- | --- |
| Loan lifecycle fixture | Purchase positive uses an explicitly affordable borrower/fee; unaffordable purchase refuses and leaves the loan/finance intact |
| Full-suite gate | Ready/package rejects any failed file beyond the exact `playerAbility` allowance identities |
| F15 scores | Paired workers measure committed `world.matches` scores after opening matchdays; deliberate score-corruption negative must fail equality |

Preserved from prior tips: canonical `participants`/`lifecycle.field`, shared paired inputs + RNG gates, B06 live/restored finance/decision equality, source completeness/year, B04 loans, partial-season rejection.

## Gates

- Focused + regression (incl. cross-league): PASS
- Cohort 14×3: 42/42, 0 oracle violations; corruption PASS
- Paired F01–F15: PASS with matched RNG; F15 committed-score positive + corruption negative
- Browser B01–B09: PASS (`requiredComplete`), B06 finance/decision equal
- Full suite: only the two established `playerAbility` assertions in `tests/playerAbility.test.mjs`

## Allowed failures

Exactly:

1. `learning 8.693485869706887` in `tests/playerAbility.test.mjs`
2. `big.realized <= 7 - r.realized + 1e-6` in `tests/playerAbility.test.mjs`

No additional failed files. Cross-league loan lifecycle must pass. B06 live/restored finance and pendingDecision must match.
