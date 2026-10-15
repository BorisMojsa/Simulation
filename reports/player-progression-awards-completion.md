# Player progression & awards — completion report

**Base revision:** `f1c848c976aa3678c3b1814913b2534bcc3def93`  
**Model:** `player-development-v3`  
**Measured calibration:** `reports/player-development-v3-calibration.json` (light run; configHash `5d4158615af36a4c`)

## What now drives growth

```
learning ≈ age/role opportunity
         × minutes opportunity
         × healthy training
         × environment/challenge
         × (1 + performanceWeight × P_long × reliability)
         × ability difficulty near 99
         × traits / breakthrough / noise
+ bounded recognition/trophy contribution
− ageing / deconditioning / regression
all under one shared annual new-learning allowance (+7)
```

- **Confidence** (`reliability`) is separate from **signed performance** (`P_long` / `seasonP`).
- Poor / neutral / good / exceptional seasons diverge under matched minutes and health.
- There is **no preassigned career maximum**. Starting OVR is only the starting point.

## Measured before → after (light calibration)

| Metric | v2 baseline (audit) | v3 light |
| --- | ---: | ---: |
| Young annual Δ mean | +2.02 | +2.26 |
| Young annual Δ p90 | +2.86 | +3.39 |
| Ordinary peak mean | 73.3 | 79.6 |
| Trajectories ever raw 90 | 0 / 800 | 5.25% |
| Ever displayed 99 (mixed traj) | 0% | 0% |
| Controlled RW mean @22 | 77.2 | 85.7 |
| Integrated career errors | 0 | 0 |

### Performance cohorts (age ~19, OVR ~72, matched inputs)

| Cohort | Median Δ | +6 rate |
| --- | ---: | ---: |
| Poor | +1.47 | 0% |
| Neutral | +3.28 | 0% |
| Good | +4.93 | 20% |
| Exceptional (+ recognition, forced BT) | +6.74 | 92.5% |

### Low-start possibility (supported successive exceptional seasons)

| Start OVR | Peak raw | Displayed 99 | Age at 99 |
| ---: | ---: | --- | ---: |
| 50 | 98.56 | yes | 29 |
| 60 | 98.70 | yes | 26 |
| 70 | 98.83 | yes | 24 |

## How awards are earned

- **Golden Boot / Glove:** competition standings (league goals / clean sheets); ties shared; cup goals excluded from league boot; no OVR gate.
- **Team of the Season:** positional slots from configured formation; role-scored evidence.
- **Player / Young / Rookie:** shortlists + evidence; young uses season-start age; rookie uses prior senior minutes (club moves do not reset).
- **World Player of the Year:** rare elite path; does not suppress other awards.
- Seeded NPC rivals persist on `player.awardFields`; awards run **before** development.

## Positional ageing

`POSITION_MATURATION` shifts effective learning/loss ages: wingers earlier physical taper; CB/CDM later; GK latest. Family curves still separate physical vs technical/mental/keeping.

## Changed files (primary)

- `js/config/playerDevelopmentConfig.js` — v3 caps, curves, recognition, awards, maturation
- `js/simulation/playerDevelopmentModel.js` — ceiling-free `developSeason`, recognition, positional rates
- `js/simulation/seasonEvidence.js` — **new**
- `js/simulation/individualAwards.js` — rebuilt
- `js/simulation/seasonSimulator.js` — awards → development order; breakthrough fix
- `js/simulation/playerModelMigration.js` — v3 migration
- `js/simulation/playerPotential.js` — outlook forecast
- Academy / senior scenario / recruitment budget bumps neutralized
- `scripts/calibratePlayerDevelopment.mjs` — harness fixes + cohorts
- Tests: `tests/playerProgressionV3.test.mjs` (+ updates to ability/behavior/chronology/academy)

## Commands run

```text
node tests/playerProgressionV3.test.mjs          # all OK
node tests/playerAbility.test.mjs                # all OK
node tests/playerDevelopmentBehavior.test.mjs    # all OK
node tests/chronologicalSeason.test.mjs          # all OK
node tests/academyOpening.test.mjs               # all OK
node tests/contractLifecycle.test.mjs            # 13/13 pass
node tests/browserFlowSmoke.test.mjs             # all passed
node scripts/calibratePlayerDevelopment.mjs --light
```

## Acceptance matrix (summary)

| Criterion | Status |
| --- | --- |
| Signed performance & confidence | Pass (tests + cohorts) |
| No inherited ceiling | Pass |
| Low-start 50/60/70 → displayed 99 (supported path) | Pass |
| Earned +6/+7 exceptional | Pass |
| Shared annual allowance | Pass (cap 7; academy charges it) |
| Golden Boot correctness | Pass (unit) |
| Multiple awards / positions | Implemented; partial unit coverage |
| Youth / rookie eligibility | Implemented; unit coverage light |
| Awards before development | Pass (seasonSimulator order) |
| Health exposure fraction | Pass (unit) |
| Migration idempotent | Pass |
| Breakthrough history field | Pass (`breakthrough.occurred`) |
| Full-engine 99 career under decision policy | **Unfinished** (not found in n=80 light integrated) |
| Full 10k/5k/2k calibration | **Unfinished** (light only this pass) |
| Browser season awards/progression screenshots | **Unfinished** (smoke only) |

## Follow-up after awards merge

`seasonSimulator` now passes `table: chrono.table` and `seasonStartAge` into `evaluateSeasonAwards` / `buildSeasonEvidence`, and attaches award records via `attachRecognitionToEvidence`. Awards unit suite (22) + progression v3 + browser smoke all green after the merge.

## Unfinished criteria (plain)

1. No seed-documented full-engine career (match sim + loans/transfers) that reaches displayed 99 yet — distinguish undersampling from structural impossibility with a larger integrated run and an intentional elite policy.
2. Full-scale calibration / holdout (10k / 5k / 2k) not executed in this session.
3. Dedicated browser QA screenshots for awards + progression summary not captured here.
4. Award nomination rate reporting by cohort is available via records but not yet a tabulated product report.
