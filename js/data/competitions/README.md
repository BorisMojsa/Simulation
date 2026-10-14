# Competition configuration notes

## UEFA / continental club competitions

Association slots: `qualification.js` (`UEFA_ASSOCIATION_SLOTS`, `AFC_ASSOCIATION_SLOTS`, `CAF_ASSOCIATION_SLOTS`).

Format definitions (rule versions): `formats.js`.

Simulation engine: `js/simulation/continentalTournament.js` (public API via `europeanCompetition.js`).

- UEFA CL/EL/UECL: league phase (36) then knockout playoffs / R16 path.
- Libertadores / Sudamericana: group phase.
- Concacaf Champions Cup: knockout with Round One + byes (no groups).
- AFC Champions League Elite / CAF Champions League: regional league or groups.

**Bootstrap:** prior-season standing when present on the same league; otherwise club-quality position bands. Entry never reuses another club/league’s table after a transfer.

## Domestic cups

Configured in `domesticCups.js` (includes Saudi Arabia, Japan, South Korea, Egypt, Morocco).

## National tournaments

Calendar + field sizes: `internationalCalendar.js`. Best-third advancement in `nationalTeam.js`.

## League formats

Declared rules vs generic DRR: `leagueFormats.js`.

## Persistence

World state holds `editions`, `matches`, `ties`, `cupResults`, `qualification`. Session-scoped; serialize/deserialize supported.
