# Senior career scenarios — calibration

Generated: 2026-10-16T00:32:19.880Z
Git: 34f15aafed4d459fd8ac20a6598db4fcb73584eb
Bank size: 80
Configured trigger probability: 0.3

## Trigger trials (independent streams)

| Competition type | Trials | Drawn | Rate |
| --- | ---: | ---: | ---: |
| league | 2000 | 644 | 32.20% |
| cup | 2000 | 613 | 30.65% |
| continental | 2000 | 592 | 29.60% |
| international | 2000 | 615 | 30.75% |

## Season plan probes

Seasons: 200
Eligible editions: 517
Drawn: 145
Shown (scheduled): 145
Unschedulable after draw: 0
Roll misses: 372

### By competition type

| Type | Editions | Drawn | Shown | Unschedulable | Miss |
| --- | ---: | ---: | ---: | ---: | ---: |
| league | 200 | 53 | 53 | 0 | 147 |
| cup | 200 | 58 | 58 | 0 | 142 |
| continental | 67 | 18 | 18 | 0 | 49 |
| international | 50 | 16 | 16 | 0 | 34 |

### Scenario frequency (scheduled)

| Scenario | Count |
| --- | ---: |
| extra-session-or-rest | 8 |
| missed-chance-response | 6 |
| press-breakthrough | 6 |
| dressing-room-photo-request | 6 |
| late-team-return | 6 |
| high-stakes-run-in | 5 |
| academy-player-trains-up | 5 |
| travel-fatigue | 5 |
| derby-provocation | 4 |
| new-shape-rehearsal | 4 |
| international-first-trip | 4 |
| substitute-preparation | 4 |
| video-pattern-review | 4 |
| critical-column | 4 |
| strong-opponent-preparation | 4 |
| transfer-rumour | 3 |
| press-after-defeat | 3 |
| fitness-load-conversation | 3 |
| household-disruption | 3 |
| sponsor-shoot | 3 |
| airport-fan | 3 |
| cup-elimination-response | 3 |
| dressing-room-frustration | 3 |
| scouting-feedback | 3 |
| individual-recovery-responsibility | 3 |
| national-bench-response | 3 |
| weather-disrupted-session | 2 |
| costly-error-review | 2 |
| family-needs-support | 2 |
| agent-public-comments | 2 |
| social-media-mistake | 2 |
| viral-training-clip | 2 |
| cleared-full-training | 2 |
| sleep-routine-disruption | 2 |
| long-interview-invitation | 2 |
| long-international-journey | 2 |
| specialist-technique-clinic | 2 |
| new-teammate-language | 2 |
| partner-important-date | 1 |
| national-role-adjustment | 1 |
| return-from-injury | 1 |
| training-unit-disagreement | 1 |
| charity-invitation | 1 |
| quiet-time-or-social-invite | 1 |
| renewal-uncertainty-focus | 1 |
| personal-study-schedule | 1 |
| training-measurement-review | 1 |
| help-young-teammate | 1 |
| misquoted-comment | 1 |
| achievement-comedown | 1 |
| community-coaching-workshop | 1 |

## Outcome category probabilities (academy reference → senior)

| Disposition | Academy +/0/− | Senior target +/0/− | Sampled +/0/− |
| --- | --- | --- | --- |
| thoughtful | 69.84 / 20.35 / 9.81 | 59.84 / 25.35 / 14.81 | 59.97 / 25.31 / 14.72 |
| balanced | 67.67 / 15.58 / 16.75 | 57.67 / 20.58 / 21.75 | 57.86 / 20.77 / 21.38 |
| ambitious | 56.50 / 13.45 / 30.04 | 46.50 / 18.45 / 35.04 | 47.02 / 18.48 / 34.51 |
| reckless | 30.80 / 9.20 / 60.00 | 20.80 / 14.20 / 65.00 | 20.86 / 14.00 / 65.14 |

## Durable development samples

Forced-category trials: 120
Positive mean raw: 0.6790 (display ticks: NaN)
Negative mean raw: -0.2244 (display ticks: 3)
Neutral zero-raw count: 40/40
Duplicate second-choice blocks: 120

## Notes

- Trigger streams are independent of match/transfer RNG.
- Outcome category rates use the academy-reference 10/5/5 transformation.
- Headless seasons use the balanced senior policy (not max-reward).
- Failed 30% rolls do not create history entries or UI modals.
- Durable attribute changes share the annual learning allowance with season development.