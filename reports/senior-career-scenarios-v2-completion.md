# Senior career scenarios v2 — completion report

Generated: 2026-10-16 (local). Base revision before work: `34f15aafed4d459fd8ac20a6598db4fcb73584eb`.

## Summary

Senior career cutscenes now apply **durable attribute development** (base OVR), use an **academy-reference probability transform** (−10 / +5 / +5 percentage points), and ship an **80-scene bank** (24 upgraded + 56 new) with full positive / neutral / negative outcomes per choice.

## Content

| Metric | Value |
| --- | ---: |
| Scenes | 80 |
| Choices | 240 |
| Authored outcomes | 720 |
| Missing category slots | 0 |
| Original 24 IDs retained | yes |
| New catalogue IDs 25–80 | yes |

Banks live in:

- `js/data/seniorCareerScenarioBankLegacy.js` (24)
- `js/data/seniorCareerScenarioBankNew.js` (56)
- assembled by `js/data/seniorCareerScenarios.js`

## Probability model

Uses `OUTCOME_WEIGHT_BY_DISPOSITION` from `academyOpeningConfig.js` as the full-table reference (−4…+4), then:

```text
shifted = min(0.10, academy.positive)
senior.positive = academy.positive − shifted
senior.neutral  = academy.neutral  + shifted/2
senior.negative = academy.negative + shifted/2
```

Verified targets (rounded):

| Disposition | Senior + / 0 / − |
| --- | --- |
| Thoughtful | 59.84% / 25.35% / 14.81% |
| Balanced | 57.67% / 20.58% / 21.75% |
| Ambitious | 46.50% / 18.45% / 35.04% |
| Reckless | 20.80% / 14.20% / 65.00% |

Sampling is two-step: category from the transformed profile, then conditional weights within the category. Normalization is idempotent (no second −10pp).

## Durable development

- `applyScenarioAbilityChange()` in `playerDevelopmentModel.js` allocates signed OVR-equivalent change across role attributes (GK uses GK keys).
- Narrative→request mapping and per-scene clamps match academy magnitudes (difficulty is probability-only).
- Shared period ledger `development.learningByPeriod[periodId]` charges gross positive gains against `annualLearningCap` (7).
- Negatives do not refund allowance.
- Event identity is choice-independent: `careerId|periodId|competitionId|editionId|senior-scene-slot`.
- Season summaries keep the original season-start baseline across pause/resume and report `sceneDevelopment`.

## UI

`seniorScenarioOverlay.js` shows **base** overall endpoints, restores a resolved result screen after save, and does not treat a failed resolve as success.

## Scheduling / eligibility

- Cup editions require real cup entry evidence (`cupRoundDates.length` or `cupEntered`), not `(length \|\| true)`.
- Fire-time selection is strict; schedule-time may soften.
- Dates spread across editions; planned IDs participate in repeat exclusion.
- Tag-flavoured pools replace the hard five-ID cup/continental preference list as the only pool.

## Tests run (automation)

All passed:

```text
node tests/seniorCareerDevelopment.test.mjs
node tests/seniorCareerScenarios.test.mjs
node tests/academyOpening.test.mjs
node tests/abilityFormatting.test.mjs
node tests/playerAbility.test.mjs
node tests/playerProgressionV3.test.mjs
node tests/chronologicalSeason.test.mjs
node tests/loanPlayingLeague.test.mjs
node tests/contractLifecycle.test.mjs
node tests/continentalIntegrity.test.mjs
node scripts/calibrateSeniorCareerScenarios.mjs --light
```

## Calibration

See `reports/senior-career-scenarios-calibration.json` / `.md` (light run). Includes trigger rates (~30%), category sampling vs targets, and forced-category development samples.

## Browser verification

Not completed in this session (no interactive browser pass). Recommended checks:

1. Positive scene crossing a whole-number OVR boundary updates overlay + card.
2. Sub-point progress without a rounded tick explains honestly.
3. Neutral leaves base unchanged; negative can drop a displayed OVR when close to a boundary.
4. Save after choice / before Continue restores the result screen once.
5. Loan / national / GK labels and choices look correct.

## Remaining limitations

- Scene banks restored from [Upgrade 24 legacy scenes](17698a5b-c3fd-4ff3-b130-c5e82e89b9ce) and [Author 56 senior scenes](a863c77b-5a7d-48c7-90de-40f03ce60cca) after an auto-generator race overwrote them; prose is now authored rather than template stubs. A final human editorial pass is still worthwhile.
- Match annotations for error/miss/rebound scenes depend on match ledger fields when present; otherwise those scenes rely on constructed/soft contexts.
- Mentoring no longer grants a latent ceiling bump; development is accounted scene learning only (as requested).
