# Third-Party Notices

## Open Football (Apache License 2.0)

- Project: Open Football — https://github.com/ZOXEXIVO/open-football
- License: Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0)
- Reference revision studied: `8ddc808ce1512e0952502a5dedc1e13d741f01e2`
- Local reference checkout (not distributed, git-ignored): `research/reference-code/open-football/`

The `player-development-v2` model (`js/config/playerDevelopmentConfig.js`,
`js/simulation/playerDevelopmentModel.js`, `playerPotential.js`, and related
modules) **conceptually adapts** ideas from the following Open Football files
under `src/core/src/club/player/development/`:

| Open Football file | Concept adapted here |
| --- | --- |
| `age_curve.rs` | Per-category (physical / technical / mental / goalkeeping) age curves for growth and decline; per-skill peak-age offsets |
| `tick.rs` | Periodic development tick structure: growth rate × modifiers, then caps, then clamping |
| `ceilings.rs` | Per-attribute ceilings derived from a latent ability budget |
| `modifiers.rs` | Multiplicative modifiers (trainability, professionalism, environment, decline protection) |
| `maturity.rs` | Biological-maturity offsets, minutes-based opportunity bands, hard per-period growth caps |
| `skills_array.rs` / `ability/skills` | Grouping of skills into categories used to blend growth and decline |

This is a clean-room re-expression in JavaScript. No source code was copied:
the algorithms were re-derived from their documented behaviour, all numeric
tables were re-tuned for this simulator's six-attribute outfield model and
six-attribute goalkeeper model, and the data model, RNG, injury, performance
ledger and forecasting layers are original to this project.

Open Football is licensed under the Apache License 2.0. A copy of that
license is available at the URL above and in the reference checkout's
`LICENSE` file. In accordance with Section 4 of the license, this notice
records that the adapted work is derived from Open Football, and that it has
been modified.
