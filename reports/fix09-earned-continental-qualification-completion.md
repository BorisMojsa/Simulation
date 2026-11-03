# Fix 09 completion — ReReview repair (317129f follow-up)

## Verdict

READY FOR REVIEW (ReReview of 317129f)

## Identities

- Branch: `fix/09-earned-continental-qualification`
- Accepted predecessor: `984495e4c12df0c2dd1c84d124bc4cb743a0f63e`
- Previous reviewed tip: `317129fc394957465fb7f9b68ac0cb2a033a7027`

## ReReview repairs (317129f remaining)

| ID | Repair |
| --- | --- |
| Full-suite classifier | Exact failing-test/assertion set: rejects unknown, extra, missing, or duplicate FAIL identities even inside `playerAbility.test.mjs`; portable three-case witness + `tests/fix09FullSuiteAllowance.test.mjs` |

Preserved from prior tips: affordable loan purchase fixture, F15 `world.matches` scores + corruption negative, canonical `participants`/`lifecycle.field`, shared paired inputs + RNG gates, B06 live/restored finance/decision equality, source completeness/year, B04 loans, partial-season rejection.

## Gates

- Focused + regression (incl. cross-league): PASS (reused; production/functional blobs unchanged)
- Cohort 14×3: 42/42, 0 oracle violations; corruption PASS (reused)
- Paired F01–F15: PASS with matched RNG; F15 committed-score positive + corruption negative (reused)
- Browser B01–B09: PASS (`requiredComplete`), B06 finance/decision equal (reused)
- Full-suite classifier three cases: supplied log accept; extra cross-league file reject; extra ability FAIL reject
- Full suite: only the two established `playerAbility` assertions in `tests/playerAbility.test.mjs`

## Allowed failures

Exactly these two identities (test name + assertion marker):

1. `development: annual cap, deconditioning is recoverable` / `learning 8.693485869706887`
2. `academy growth mutates attributes and charges shared annual allowance` / `big.realized <= 7 - r.realized + 1e-6`

No additional failed files or FAIL assertions. Cross-league loan lifecycle must pass. B06 live/restored finance and pendingDecision must match.
