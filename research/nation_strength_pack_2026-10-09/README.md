# National strength research pack

Complete selected published points for the 79 national teams in the supplied Simulation inventory, for the ranking edition labelled **7 October 2026**. Researched 9 October 2026.

The package supplies **59 replacements** for previously unresolved national baselines. It contains **no rank-to-points interpolation or arbitrary point priors**. All 20 existing numeric points and all 30 rank-only entries agree with the selected table. All 79 IDs remain unchanged.

## How to use it

1. Extract this folder into the Simulation repository under research/nation_strength_pack_2026-10-09/.
2. Send Cursor the complete text in Cursor_Prompt.txt. The separately delivered Simulation_Cursor_National_Strength_Prompt.txt has the same content.
3. Let Cursor inspect the actual current code, import the observations, correct the registry, rebuild and run its checks. This pack is research and instructions; it does not modify the repository.
4. Run python3 validate_pack.py in this folder to check the supplied evidence, identities, data counts and checksums.

## Evidence and limits

The main [Betimate](https://betimate.com/en/fifa-ranking) and [Futbor](https://futbor.com/fifa-rankings/) point tables agree for all 79 inventory nations. Their pages identify the edition as 7 October 2026 and display a 211-team ranking. This package captures the application's 79 teams, rather than claiming a complete official 211-row export.

[B-Empire Magazine](https://b-empiremagazine.com/en/classement-fifa/) agrees on points for 78 of the 79. For Australia it displays **1585.52**, whereas the two main tables and an [additional country profile](https://fifarankingcalculator.com/team/australia/) display **1580.52**. The selected value is 1580.52; the conflicting observation is preserved unchanged in raw/ and source_discrepancies.json.

The numeric observations are **corroborated secondary republications of FIFA points**. A direct official FIFA numeric export was not obtained. This research pack contains **zero directly primary-verified FIFA point observations**. Multiple publishers may share an upstream feed; agreement is not proof of independence. Do not advertise the pack as an official FIFA download.

Publication timestamps were not verified, so publicationDate is null. The stated edition date, retrieval date and report-generation date are distinct. Raw/ contains extracted factual data, with explicit publishers and URLs; it does not contain archived full HTML responses.

[FIFA's methodology](https://inside.fifa.com/fifa-rankings/world-ranking/procedure-men) describes SUM, introduced in August 2018, which changes existing point totals after results while considering relative strength. This pack does not reconstruct 35 years of tournament results. The published numeric observations remove the need to create a historical fallback for these 59 gaps.

Game quality, positional ratings and replacement OVRs are separate model outputs. They are not four verified FIFA attributes. The Cursor prompt preserves the shared match engine and requires explicit, versioned transformations and career snapshots.

## Canonical confederation corrections

The supplied report assigned FIFA as the confederation for three teams. Correct the underlying canonical registry and competition eligibility.

| Nation | Correct confederation | Primary membership evidence |
| --- | --- | --- |
| Hungary | UEFA | [FIFA association profile](https://inside.fifa.com/en/associations/HUN/organisation) |
| Mali | CAF | [FIFA association profile](https://inside.fifa.com/en/associations/MLI/organisation) |
| Venezuela | CONMEBOL | [FIFA association profile](https://inside.fifa.com/associations/ven) |

The supplied 79-team inventory has UEFA 31, CAF 15, CONCACAF 10, CONMEBOL 10, AFC 12 and OFC 1. Eligibility belongs to canonical identity and explicit tournament rules, separately from strength.

## Club calibration review

The existing five FootballDatabase-to-ClubElo conversions remain model-derived. The uploaded report shows overall leave-one-club-out MAE falling from 60.42 to 28.34 Elo; Serbia has the largest country MAE, 44.99. AVS is nine FootballDatabase points below its country's paired sample range.

See club_calibration_audit.md and club_calibration_audit.json. The 75 prior published observation pairs are included to support range checks and reproducibility. The actual fitting code, coefficients and regularization selection were not available in the uploaded reports. Cursor must verify them before claiming independent statistical validation. The pack does not prescribe arbitrary replacement ratings or discard outliers.

## Files

| File | Purpose |
| --- | --- |
| Cursor_Prompt.txt | Complete implementation prompt, including all 79 selected points |
| nation_observations_79.json | Selected points, stable IDs and row-level provenance |
| nation_replacements_59.json | The previously unresolved subset |
| nation_identity_mappings.json | Explicit aliases and confederation corrections |
| raw/ | Three 79-team publisher extracts and the Australian supplemental observation |
| source_manifest.json | Publishers, source URLs, evidence tiers and limitations |
| source_discrepancies.json | Preserved Australian discrepancy and selection rationale |
| research_coverage_summary.json | Coverage and identity audit counts |
| club_calibration_audit.md/json | Review of the uploaded five-club calibration |
| paired_club_observations_75.json | Prior cross-provider pairs with dates and source URLs |
| input_reports/ | The two uploaded reports, unchanged |
| validate_pack.py | Offline package integrity and factual matching checks |
| SHA256SUMS.json | SHA-256 for every other package file |

The current uncommitted application code has not been directly audited here. The prompt requires Cursor to finish that audit and report actual implementation and test results.
