# Fix 10 completion — Club strength profiles & superstar impact

## Verdict

READY FOR INDEPENDENT REVIEW

## Identities

| Item | Value |
| --- | --- |
| Branch | `fix/10-club-strength-profiles-superstar-impact` |
| Accepted base | `296a14f2e921e68a946a802605e472662cb0894e` |
| Model | `fix10-club-strength-v1` / `fix10-lineup-impact-v1` |
| Schema | `WORLD_STATE_SCHEMA_VERSION = 4` |

## Section 3 repairs

| Finding | Fix | Evidence |
| --- | --- | --- |
| 3.2 Tiny superstar influence | Role-local unit weights + soft δ/(1+\|δ\|/30) map; XG_MODEL unchanged | F06, calibration-summary, matched compare (Hull 99 ST xG 1.30→1.49) |
| 3.3 Secondary attrs ignore minutes | Minute-scale full contribution vector before rounding | F04 |
| 3.4 Replacement OVR stuck | Fractional `toFixed(4)` evolution; no baseline rewrite | F09, B06 |
| 3.5 ET keeps subbed player bonus | `phaseEffectiveStrength` from immutable regulation evidence | F11, B07 |
| 3.1 Estimated equal units | Honest cue “Estimated unit ratings”; asymmetric fixtures consumed | F01, F02, F14, B01, B05 |

## Numeric contract (frozen targets)

See `qa/fix10-runs/calibration-targets.json`. Gates pass for qualities 55/70 × ST/CM/CB/GK.

Representative (q=70, 99, 90′, neutral attrs): ST own xG ~+22%, GK opp xG ~−16%, EP gains ~0.15–0.20, 99−90 EP ≥0.02, bounds ≤12 / ≤6.

## QA summary

| Gate | Result |
| --- | --- |
| Focused F01–F16 | PASS |
| Calibration + 5k MC + seasons | PASS (`qa/fix10-runs/calibration-summary.json`) |
| Matched base/final | PASS (self-replay exact; base SHA `296a14f`) |
| Career cohort 24×3 | 23 complete + 1 documented Yokohama AFC schedule exclusion |
| Browser B01–B08 | PASS (`selectedOk`) |
| Regression gate (Fix05–09 list) | PASS |
| Full suite | Passed with the established ability exception |
| PT exporter | PASS (capacity pin 3810 after ET cup stamp) |
| Injury exporter | D-PR1 fails on accepted base identically — not a Fix 10 regression |
| Match/awards/earned exporters | PASS |

### Ability exception (exact)

1. `development: annual cap, deconditioning is recoverable` / `learning 8.693485869706887`
2. `academy growth mutates attributes and charges shared annual allowance` / `big.realized <= 7 - r.realized + 1e-6`

## Limits

- All 572 club units remain estimated-equal at dataset level; no new positional research.
- Synthetic 99 fixtures are controlled QA, not Fix 11 natural-peak proof.
- One career cohort exclusion: Yokohama continental league-phase schedule builder failure (pre-existing continental scheduler issue).
- Injury D-PR1 pause/restore twin mismatch reproduces on Fix 09 tip in this environment.

## Source touchpoints

- `js/simulation/teamStrength.js` — impact model, phase strength, provenance helpers
- `js/simulation/matchEngine.js` — ET phase strength + venue
- `js/simulation/worldState.js` — fractional replacements, schema 4, model version
- `js/ui/rendering.js` — unit ratings cue
- Tests/scripts under `tests/clubStrengthSuperstarImpact.test.mjs`, `scripts/qaClubStrengthSuperstarImpact.mjs`, `scripts/qaFix10MatchedCompare.mjs`, `scripts/browserClubStrengthSuperstarImpactChecklist.mjs`, package/verify scripts
