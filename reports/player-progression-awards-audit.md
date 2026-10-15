# Player progression & awards — audit and architecture (v3)

**Revision:** `f1c848c976aa3678c3b1814913b2534bcc3def93` (working tree implements v3 atop this base)  
**Model:** `player-development-v3` / `PLAYER_MODEL_VERSION = 3`  
**Config hash (at report time):** see `reports/player-development-v3-calibration.json`

## Baseline defects reproduced

| Defect | Evidence |
| --- | --- |
| Latent budgets / attribute ceilings capped careers | `LATENT_BUDGET_BANDS` + `developSeason` `budgetFactor` / `budgetRoom`; ordinary trajectories never reached raw 90 under v2 light calibration |
| Signed performance used as confidence | `reliable = clamp(reliableSignal)` zeroed negative seasons; matched probes showed age-18 poor=neutral=good |
| Awards after development | `seasonSimulator` called `developSeason` before `simulateIndividualAwards` |
| Awards OVR lottery + `Math.random` | Golden Boot gated by rating; Team of Season rolled |
| Coarse healthy fraction | `activeInjury ? 0.35 : 0.9` |
| Breakthrough history wiring | `breakthroughTriggered` vs `breakthrough.occurred` |
| Calibration loop / breakthrough logging | `y < opts.years \|\| 20`; `breakthrough: false` always |

## Final architecture

1. **No individual career ceiling.** Active growth ignores `latentAbilityBudget` / attribute ceilings. Legacy values are archived under `development.legacyArchive`. Shared scale max remains 99.
2. **Season evidence** (`seasonEvidence.js`): minutes, signed `seasonP`, separate `reliability`, competition splits, healthy fraction from injury exposure, trophies with participation weights.
3. **Awards first** (`individualAwards.js`): competition-scoped Golden Boot / Glove, positional TOTS, POTS, Young POTS, Rookie, rare World POY; seeded rivals; nominations vs wins; no unseeded RNG.
4. **Development once** (`developSeason`): age/role curves × opportunity × health × environment × signed performance×confidence × ability difficulty × recognition, under shared annual allowance (+7).
5. **Positional maturation** via `POSITION_MATURATION` / `POSITION_ROLE_GROUP` (GK/CB later; wingers earlier physical taper).
6. **Forecast** is a revisable outlook, not a max (`playerPotential.js`).
7. **Migration** `migratePlayerToV3` deactivates ceilings without rerolling attributes.

## Season completion order

Evidence freeze → trophies → awards → `developSeason` → forecast refresh → season record (explanations, breakdown, `breakthrough.occurred`, award records).

## Known limitations

- NPC award rivals are seeded approximations, not a full player database.
- Light calibration (800/400/80) used for iteration; full 10k/5k/2k not re-run in this pass.
- No reproducible full-engine (match+decision) career to displayed 99 yet — supported-input paths prove possibility; integrated mixed sample (n=80 light) had 0 ever-99.
- Academy opening positive cap (`openingPositiveCap: 3.6`) is still below the shared senior annual 7 by design for the opening year feel.
- Browser UI checks of a live completed season were not re-shot in this pass (smoke tests passed).
