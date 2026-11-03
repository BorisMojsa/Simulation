# Fix 09 completion — ReReview repair (ebbe1d1 follow-up)

## Verdict

READY FOR REVIEW (ReReview of ebbe1d1)

## Identities

- Branch: `fix/09-earned-continental-qualification`
- Accepted predecessor: `984495e4c12df0c2dd1c84d124bc4cb743a0f63e`
- First reviewed tip: `b874040211c82e8f4aafebdbde28df447112e228`
- Previous reviewed tip: `ebbe1d19b9621da6cfe8d9c0b84f6ed778255c19`

## ReReview repairs (ebbe1d1 remaining)

| ID | Repair |
| --- | --- |
| R1 | AFC `buildRegionalField` filters known DNQs / wrong-competition clubs before feasibility; falls through to limited inventory instead of refilling with DNQs |
| R2 | Zero-played and partially played full-roster tables rejected without registry mutation |
| R3 | Mid-season arrivals at the immutable focus club lose the focus exemption (`allowFocusExemption: false`) |
| R4 | Edition-scoped league fixture IDs + immutable `sourceResults`; oracle rebuilds standings and rejects wrong-year / wrong-identity / display-name-only; career snapshots include player |
| R5 | Browser B01/B04/B06/B07/B09 assert real finish→entry, controlled Brentford loan, mid-season pause branch, Brazil rollover, and FA search→resign transitions |
| R6 | Preserved — injury twin + package identity gates unchanged |

## Gates

- Focused F01–F25: PASS
- Cohort 14×3: 42/42 periods, 0 oracle violations; 42/42 source editions cite correct-year matches
- Browser B01–B09: PASS (`requiredComplete`)
- Full suite: only established `playerAbility` allowance remains

## Allowed failures

Exactly the two documented `playerAbility` assertions from Fix 08. No injury ambient claim.
