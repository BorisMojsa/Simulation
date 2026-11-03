# Fix 09 completion — earned continental qualification

## Result

Continental entry is resolved from **club + domestic edition evidence** on `world.qualification`, not from a transferred `playerRow` or club OVR bands. Shared continental editions are frozen across focus changes.

## What changed

- New `js/simulation/earnedQualification.js`: edition-scoped registry, bootstrap, migration, club resolver.
- `qualification.js`: strict rank validation; France three-CL comment corrected.
- `chronologicalSeason.js`: `preSeasonContinentalStanding` uses the resolver; finalize commits completed tables.
- `continentalTournament.js`: reuse existing editions regardless of focus; prefer earned peers when building new fields; inventory fills remain synthetic.
- Focused tests F01–F25, QA exporter (14×3 cohort), browser B01–B09, package script.
- Downstream fixture updates for ownership / playing-time pins that relied on OVR proxies.

## Gates

| Gate | Result |
| --- | --- |
| F01–F25 | pass |
| 14×3 cohort | 42 periods, 0 oracle violations |
| B01–B09 | pass |
| Ownership / playing-time / formats / continental integrity | pass |
| Injury exposure deep-equal pin | pre-existing ambient fail on Fix 08 tip as well |

## Limitations

- Background continental fields may still include synthetic clubs; they are marked `entryRoute: synthetic-fill` and do not override earned player entry.
- Blocking every domestic non-qualifier from inventory fill was intentionally not applied — it desynced career RNG from prior fixtures without improving focus-club entry integrity.
- Bootstrap is a bounded player-free simulation, not real-world access lists.
