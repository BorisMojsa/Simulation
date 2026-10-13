# Football strength source research — 8 October 2026

Copy this whole folder into the Simulation repository, then give Cursor the text in `Simulation_Cursor_Researched_Strength_Prompt.txt`.

The uploaded coverage report contains 490 clubs: 35 previously marked verified and 455 provisional. This pack supplies published raw observations for all 455 gaps: **450 ClubElo values dated 8 October 2026 and 5 FootballDatabase values dated 4 October 2026**. It also includes ClubElo observations for the 35 previously verified club names, allowing new careers to move to a consistent primary provider. The IDs for those 35 must be resolved from the current repository; they were not present in the uploaded gap list.

These are provider observations, not finished game strengths. All imported observations require a versioned conversion into the game's strength units. The five FootballDatabase observations additionally require a validated conversion into the primary provider's scale. Current profiles, positional ratings, replacement OVRs, player contribution, match probabilities and source confidence are separate things.

| File | Purpose |
| --- | --- |
| `Simulation_Cursor_Researched_Strength_Prompt.txt` | Complete implementation instructions |
| `replacement_observations_455.json` | Every supplied gap ID, matched to a published observation and source URL |
| `replacement_observations_455.csv` | Readable view of the same 455 observations |
| `clubelo_observations_existing_35.json` | Primary-provider observations for the 35 other club names |
| `raw_clubelo_country_tables.json` | 1,321 displayed provider rows, including original labels and provisional markers |
| `raw_footballdatabase_country_tables.json` | 160 rows from five country tables; published dates and attribution retained |
| `cross_provider_anchor_pairs.json` | 75 explicitly matched clubs observed by both providers |
| `calibration_diagnostics.json` | Preliminary held-out comparisons; no conversion is declared validated |
| `historical_source_manifest.json` | Checked archive entry points for 21 countries, domestic cups and continental competitions |
| `research_coverage_summary.json` | Counts, scope and remaining conversion work |

## Five clubs using the second provider

| Club | Published FootballDatabase points | Reason for provider selection |
| --- | ---: | --- |
| RAAL La Louvière | 1312 | ClubElo lists two potentially different La Louvière identities |
| Alianza | 1364 | Current-name observation avoids an unproven old-name join |
| Varaždin | 1427 | Modern club must not automatically inherit a Varteks-labelled observation |
| AVS | 1335 | Not present in the captured ClubElo table; CD das Aves is a separate row |
| Vojvodina | 1517 | ClubElo's Novi Sad label is not accepted without further identity evidence |

Source values above are **not ClubElo ratings or game OVRs**. FootballDatabase country rankings: [Belgium](https://footballdatabase.com/ranking/belgium/1), [Colombia](https://footballdatabase.com/ranking/colombia/1), [Croatia](https://footballdatabase.com/ranking/croatia/1), [Portugal](https://footballdatabase.com/ranking/portugal/1), [Serbia](https://footballdatabase.com/ranking/serbia/1). Each captured table states that it was updated after matches played on 4 October 2026.

## Source and identity checks

Primary club observations came from the publicly rendered country sections of [ClubElo Ranking](https://clubelo.com/Ranking). They are a structured transcription of displayed integers, not a bulk API export and not an Opta dataset. Rows marked provisional by the provider are preserved in the larger raw table, but none of the 485 selected ClubElo observations has that marker.

All 455 existing gap IDs are preserved verbatim. Matching uses unique names within the provider's country section or explicit reviewed aliases. Fuzzy suggestions were not automatically accepted. Additional identity evidence: [Internacional de Bogotá's official history](https://interbogota.com/historia) identifies its La Equidad origin; [RC Celta's announcement](https://rccelta.es/club/actualidad/el-filial-celeste-se-denominara-desde-la-proxima-temporada-celta-fortuna-como-homenaje-a-los-origenes-del-club/) confirms Celta B became Celta Fortuna; ClubElo's Ceuta link resolves to [ad-ceuta-fc](https://clubelo.com/ad-ceuta-fc). A later profile can show a different rating date from the pinned main ranking snapshot; do not splice those values into this snapshot.

The broader FootballDatabase country pages also contain old or inactive clubs. Only explicitly identified current clubs were used as calibration pairs. A published country-table date does not independently prove the date of a club's last rated match. The raw FootballDatabase table does not state provisional status per row; this pack records it as unknown rather than asserting that every rating is mature.

## Conversion evidence

The 75 same-club pairs span Belgium (15), Portugal (17), Croatia (9), Serbia (15) and Colombia (19), with four days between provider snapshots. A preliminary leave-one-club-out linear comparison had a mean absolute error of 60.42 Elo points for a single global fit and 14.28 for separate country fits. Serbia retained an average error of 33.63, with material disagreement for Zemun and Mačva Šabac. These diagnostics justify testing a regularized, evidence-based provider conversion. They do **not** establish a final conversion or prove match prediction accuracy. Do not silently drop disagreeing clubs or hand-pick country offsets.

## History and national teams

No 35-season archive has been ingested or ranked in this pack. The historical manifest records checked entry points and limitations. If a genuinely missing club needs a derived rating, collect its available results inside a documented 35-year window, including relevant domestic cups and continental matches, and disclose gaps. Do not substitute champion lists for complete results or claim that FootballDatabase covers 35 years: its methodology says its match data are mainly from January 2009 onward.

The uploaded report contains **clubs only**. No national-team ratings are supplied here. Cursor must inspect the current national inventory and produce a separate exact coverage report. FIFA points, national Elo values, club Elo values, ranks and derived game strength are distinct quantities.

## Attribution

Published club rating data: ClubElo, <https://clubelo.com/Ranking>, displayed 8 October 2026. Secondary club rating data: FootballDatabase, five country URLs above, displayed 4 October 2026, <https://footballdatabase.com/methodology.php>. FootballDatabase displays a CC BY-SA 4.0 notice; preserve attribution and applicable sharing terms for its data and adaptations. Historical archive entry points: RSSSF and its named contributors, with links in the manifest. No official provider affiliation is claimed.
