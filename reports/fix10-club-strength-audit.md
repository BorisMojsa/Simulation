# Fix 10 audit — Club strength, unit profiles, superstar impact

**Base:** `296a14f2e921e68a946a802605e472662cb0894e` (Fix 09)  
**Branch:** `fix/10-club-strength-profiles-superstar-impact`  
**Date:** 2026-11-03

## Call graph (production)

```
sportingProfileFromTeam(team, worldState)
  → world.clubs / resolveClub / resolveNation
playerLineupImpact(profile, player, {minutes, matchDuration})
  → role-local unit weights × soft OVR map × minuteShare (+ minute-scaled secondary attrs)
effectiveTeamStrength(...)
  → profile units + impact + bounded form
expectedGoals(homeEff, awayEff, venue)   [XG_MODEL unchanged]
simulateMatch → regulationEffectiveStrength (immutable)
simulateExtraTime → phaseEffectiveStrength(regulation, phaseMinutes)
  → non-continuing players contribute 0 to ET / subsequent shootout strength
adjustQuality / applySeasonDevelopment → fractional replacementOvr evolution
describeTeamStrength → UI “Estimated unit ratings” cue when derived_neutral
```

## Section 3 findings

| ID | Defect | Root cause | Correction |
| --- | --- | --- | --- |
| 3.2 | Superstar influence too small (~1–2 pp win prob for 99 ST) | `tanh(δ/18)*18 × 1/11 × role` then four-unit mean diluted gameplay | Role-local unit shares (`LINEUP_IMPACT_MODEL` soft map δ/(1+\|δ\|/30) × squadFactor × weights). XG_MODEL retained. |
| 3.3 | Secondary attrs ignore minutes | Attr deltas added after minute scaling of OVR only | Attr contributions multiplied by `minuteShare` before rounding |
| 3.4 | Replacement OVRs stuck under evolution | `Math.round(prev + d*0.5)` discarded sub-integer steps | Fractional `toFixed(4)` retention; schema v4 migration idempotent; baselines not rewritten |
| 3.5 | ET kept regulation player bonus | `simulateExtraTime` reused `match.effectiveStrength` | `phaseEffectiveStrength` from immutable regulation profile+form; 0 minutes if not continuing |
| 3.1 | Equal ATK/MID/DEF/GK | Honest estimated fallback, not a bug by itself | Keep neutral estimates; surface “Estimated unit ratings”; consume asymmetric fixtures correctly |

## Numeric contract (frozen)

See `qa/fix10-runs/calibration-targets.json`. Representative final values (neutral attrs, 90′, equal units):

| Check | Target | Observed (engine) |
| --- | --- | --- |
| 99 ST @70 own xG | +15–35% | ~22.1% |
| 99 GK @70 opp xG | −12–30% | ~−16.3% |
| 99 roles EP @55/70 | +0.10–0.40 | ~0.15–0.26 |
| 99 vs 90 EP @70 | ≥0.02 | ≥0.020 each role |
| Unit / overall bounds | ≤12 / ≤6 | within |
| Elite diminishing | EP@88 < EP@55 | holds |

## Provenance / display

- Runtime inventory: **572** clubs (490 base + AFC/CAF supplement), **79** nations.
- All starting club units remain equal overall (derived_neutral). No manufactured fame/finance differentiation.
- UI cue when estimated: **Estimated unit ratings**.

## Model metadata

- `LINEUP_IMPACT_MODEL.version` = `fix10-lineup-impact-v1`
- `CLUB_STRENGTH_MODEL_VERSION` = `fix10-club-strength-v1`
- `WORLD_STATE_SCHEMA_VERSION` = 4 (fractional replacement evolution; saved values retained)

## Out of scope (preserved)

Fix 11 development curves; Fix 08 awards; continental access lists; finance/reputation match multipliers; hand-authored named-club strength edits.
