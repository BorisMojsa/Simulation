# Competitions implementation recap (Prompt 3)

**Date:** 13 October 2026  
**Base commit audited:** `5b5aa2c56dd97c54611f52ba73fb939f76da20b9`

## Supported leagues (31)

| League ID | Clubs | Format status | Continental entry | Result views |
| --- | ---: | --- | --- | --- |
| England Premier League | 20 | Generic DRR | UEFA slots | Table + fixtures |
| England Championship | 24 | Partial (no playoffs) | — | Table |
| Bundesliga / 2. Bundesliga | 18/18 | Generic DRR | UEFA / promo | Table |
| La Liga / LaLiga 2 | 20/22 | Generic DRR | UEFA / promo | Table |
| Serie A / Serie B | 20/20 | DRR / partial playoffs | UEFA / promo | Table |
| Ligue 1 / Ligue 2 | 18/18 | Generic DRR | UEFA / promo | Table |
| Brasileirão Série A | 20 | Partial calendar-year | Libertadores/Sudamericana | Table |
| Belgian Pro League | 16 | Simplified (no split) | UEFA | Table |
| Liga Profesional (ARG) | 30 | Simplified multi-phase | Libertadores/Sudamericana | Table |
| Primeira Liga | 18 | Generic DRR | UEFA | Table |
| Ekstraklasa | 18 | Generic DRR | UEFA | Table |
| Danish Superliga | 12 | Simplified split | UEFA | Table |
| Eliteserien | 16 | Partial calendar | UEFA | Table |
| Liga MX | 18 | Simplified Apertura/Liguilla | Concacaf | Table |
| Categoría Primera A | 20 | Simplified | Libertadores/Sudamericana | Table |
| Eredivisie | 18 | Generic DRR | UEFA | Table |
| LigaPro Serie A | 16 | Simplified | Libertadores/Sudamericana | Table |
| Süper Lig | 18 | Generic DRR | UEFA | Table |
| MLS | 30 | Simplified conferences | Concacaf | Table |
| Czech First League | 16 | Simplified championship group | UEFA | Table |
| Croatian HNL | 10 | Simplified (2× RR vs 4×) | UEFA | Table |
| Serbian SuperLiga | 16 | Simplified split | UEFA | Table |
| **Saudi Pro League** | 18 | Generic DRR | AFC Elite | Table |
| **J1 League** | 18 | Partial calendar | AFC Elite | Table |
| **K League 1** | 12 | Simplified split | AFC Elite | Table |
| **Egyptian Premier League** | 18 | Generic DRR | CAF CL | Table |
| **Botola Pro** | 16 | Generic DRR | CAF CL | Table |

Declared per-league notes: `js/data/competitions/leagueFormats.js`.

## Club competitions simulated

| Competition | Opening phase | Field | Knockout | Notes |
| --- | --- | ---: | --- | --- |
| UEFA Champions League | League phase | 36 | Playoffs → R16 → Final | 8 opponents, 4H/4A target |
| UEFA Europa League | League phase | 36 | Same path | |
| UEFA Conference League | League phase | 36 | Same path | 6 opponents |
| Copa Libertadores | Groups (8×4) | 32 | R16→Final | H/A groups |
| Copa Sudamericana | Groups | 32 | Playoff path | Crossover with Libertadores thirds declared; shared state still approximate |
| Concacaf Champions Cup | Knockout | 27 | R1 (22) + 5 byes → Final | No invented group stage |
| AFC Champions League Elite | Regional league | 32 | R16→Final | West/East when pool allows |
| CAF Champions League | Groups (4×4) | 16 | QF→Final | |

## National tournaments

| Tournament | Field | Groups | Advancement |
| --- | ---: | --- | --- |
| FIFA World Cup | 48 | 12×4 | Top 2 + 8 best thirds → R32; third-place match |
| UEFA EURO | 24 | 6×4 | Top 2 + 4 best thirds → R16 |
| Copa América | 16 (pool) | 4×4 | Top 2 → QF |
| AFCON | 12 | 4×3 | Pool-limited (15 CAF nations in inventory) |
| Gold Cup | 8 | 2×4 | Pool-limited |
| Asian Cup | 12 | 4×3 | Pool-limited |

Qualifier truncation removed: knockout size must be a power of two after groups + best-thirds, or the sim throws.

## Result store & UI

- `competitionStore.js`: editions / matches / ties on world state (serialized).
- Career desk **Competitions** panel: season → competition → Overview / Groups·League phase / Knockout / Fixtures.
- Bracket cards always show names + scores (no badge-only inward rounds); feeder IDs stored on ties; final score treats 0 as valid.

## Fixes landed

1. UEFA pre-season standing keeps / derives qualification (no more nulling CL entry).
2. Position fallback for UEFA/AFC/CAF entry labels.
3. Continental formats upgraded from 16-team KO-only.
4. Destination cup rounds advance borrower’s cup bracket.
5. International dating uses edition summer with distinct match days.
6. Honors copy prefers “continental titles”.

## Intentional approximations / open integrity gaps

- Chronological continental path still pre-sims the tournament then re-sims player matches; `reconcileCampaignWithPlayerMatches` patches matching ties but does **not** yet fully rebuild later opponents from a changed winner (acceptance item 6 partially open).
- Domestic league scheduling remains shuffled DRR with Aug–May dating for most leagues; split/conference/calendar-year leagues are declared simplified in `leagueFormats.js`.
- Sudamericana ↔ Libertadores third-place crossover is format-declared; not yet a fully shared live edition between two simultaneous campaigns.
- AFCON/Asian Cup remain pool-limited below real 24-team fields (nation inventory).
- AFC/CAF strengths are ClubElo public-page transcriptions (2026-10-13); badges not fetched.

## Tests

- `tests/competitionsFormats.test.mjs` — qualification, league phase, Libertadores groups, WC/EURO sizes.
- Updated club-count expectations for 572 profiles / 31 leagues.
- Ran: competitionsFormats, chronologicalSeason, careerFlowSmoke, teamStrength (pass).
