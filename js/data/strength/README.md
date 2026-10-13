# Team strength — sources and transforms

Bundled sporting baselines for every senior club in `league-data.js` and national teams used by the game.

## What history means

ClubElo, Opta Power Rankings and FIFA men’s rankings are Elo-style systems: a published rating **already embeds** a history of results.  

This game therefore treats a **verified or published starting rating** (or a documented calibrated conversion into the primary scale) as the historical-performance baseline. It does **not** add a second match-strength bonus for trophies, fame, association coefficients, or financial tier. Reputation and finance remain separate for prestige/wages/transfers. Career form and bounded development then evolve inside the simulated world.

## Provider vs game fields

| Layer | Meaning |
| --- | --- |
| Raw provider rating | ClubElo display Elo, FootballDatabase points, or FIFA points — stored unchanged |
| Primary club scale | ClubElo (direct or calibrated from FootballDatabase) |
| Team quality (`overall`) | Transformed game ability (`team-quality-v3`) |
| ATK/MID/DEF/GK | Derived (`neutral_equal_split_v1`) unless future positional evidence exists |
| Replacement OVR | Derived band for user lineup impact — **not** a published observation |

ClubElo 1900 ≠ player OVR 90. FIFA points and FootballDatabase points are separate scales.

Transforms (frozen in `config/transform.json`):

```
clubQuality = clamp(-25.072479 + 0.05800793 * clubElo, 30, 94)
nationQuality = clamp(28 + (fifaPoints - 800) * 0.055, 40, 93)
```

Five clubs without an accepted ClubElo identity join use FootballDatabase points converted by `fdb-to-clubelo-regularized-country-v1` (regularized country-aware linear model fitted to 75 same-club pairs; leave-one-club-out diagnostics in `config/fdbToClubEloCalibration.json` and `reports/club-calibration-audit-report.json`).

## Status labels

| Field | Values |
| --- | --- |
| `ratingSourceStatus` | `published_rating` / `verified_rating` / `results_derived` / `unresolved` |
| `strengthDerivationStatus` | `normalized_from_published_rating` / `calibrated_from_published_rating` / `results_derived` / `unresolved_conversion` |
| `sourceEvidenceTier` | e.g. `corroborated_secondary` for secondary FIFA republications |
| `sourceStatus` | Compatibility mirror of rating evidence |

`published_rating` means a numeric observation was selected from published tables. It is **not** a claim of a direct official FIFA download. `directPrimaryPointsVerified` remains false unless primary evidence is stored separately.

Derived positional components and replacement OVRs are never labelled as provider-verified.

## Snapshots and dates

| Dataset | Baseline snapshot ID | Display / publication date | Retrieval |
| --- | --- | --- | --- |
| Clubs (ClubElo primary, 485) | `clubelo-public-ranking-2026-10-08` | Displayed **2026-10-08**; `ratingAsOfDate` unknown per club | 2026-10-08 |
| Clubs (FootballDatabase gap, 5) | `footballdatabase-gap5-2026-10-04` | Updated after matches **2026-10-04** | 2026-10-08 |
| Clubs (archived Opta) | `opta-public-top30-spursweb-2026-06-06` | **2026-06-06** — provenance only | 2026-10-08 |
| Nations (FIFA inventory 79) | `fifa-men-2026-10-07-inventory79-secondary-v1` | Ranking edition **2026-10-07**; `publicationDate` unknown | 2026-10-09 |

Selected nation inputs: `raw/nation_observations_79.json` (content hash recorded on rebuild). Raw publisher extracts: `raw/fifa_secondary_2026-10-07/`. Identity mappings: `config/nation_identity_mappings.json`. Australia retains a conflicting B-Empire observation (1585.52) while selecting 1580.52.

New careers freeze club and nation baselines (including nation points, evidence tier, dataset/content hash, transform version, and resolved conflicts) so a later data rebuild cannot silently rewrite an active career. Legacy careers without `baselineNations` freeze from their live nation map and keep any prior 1180 values marked via `legacyGameplayPointsPrior`.

Research packs:
- Clubs: `research/strength_pack_2026-10-08/`
- Nations: `research/nation_strength_pack_2026-10-09/`

## Rebuild (offline)

```bash
node scripts/buildClubStrengthDb.mjs
node scripts/buildNationStrengthDb.mjs
node scripts/auditFdbClubEloCalibration.mjs
```

Raw inputs live under `js/data/strength/raw/`. Identity mappings, calibration and transform config under `js/data/strength/config/`. Reports under `reports/`.

League-centre priors are **not** used for new-career club baselines. National gameplay no longer uses the provisional 1180 prior.

## Coverage

See `reports/strength-coverage-report.json`, `reports/strength-calibration-report.json`, `reports/nation-strength-coverage-report.json`, and `reports/club-calibration-audit-report.json`.

**Source-access limits:** ClubElo HTTP API was not used (403); values come from transcribed public ranking tables. National points are corroborated secondary republications of the 7 Oct 2026 FIFA men’s ranking for the 79-team inventory (not a complete 211-row official export; direct primary FIFA numeric export not obtained).

## Product labels

UI shows compact **Team strength** and may note starting-data context in docs/debug — not “live ClubElo rating” or “official FIFA API rating”.
