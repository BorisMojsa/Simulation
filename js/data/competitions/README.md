# Competition configuration notes

## UEFA club competitions (simplified)

Association slots are in `qualification.js` (`UEFA_ASSOCIATION_SLOTS`).

- Big-5: up to 4 CL + EL + UECL places from the top flight table.
- Mid associations (PT, NL, BE, TR): 2 CL + EL + UECL.
- Smaller UEFA associations in the DB (including **Serbia**, **Croatia**, **Czech Republic**): 1 CL (champions) + EL + UECL.

Eligibility uses stable `leagueId` values, not fragile display-name string equality.

**Bootstrap:** the first seasons use the just-simulated domestic table for continental entry (no prior-season ledger yet). Documented intentional simplification.

Tournaments are **knockout-only** fields (typically 16 / 8), not the full real-world league-phase UCL format.

## Domestic cups

Configured in `domesticCups.js`. Multi-division fields use `divisionLevel`. Byes are explicit and do not update form/ratings.

## Copa América

Eligible pool = CONMEBOL core + configured CONCACAF invites only. Field size 12 / groups of 3 / top-2 → 8 knockout teams. **No repair insertions** from other confederations.

## National call-ups

Nation must be eligible for the tournament field before call-up. Call-up uses player OVR vs national positional quality and club **sporting** overall (not financial tier).

## Persistence

World state is **session-scoped** for a career (`createWorldState`). `serializeWorldState` / `deserializeWorldState` support round-trips; there is no refresh/localStorage persistence yet.
