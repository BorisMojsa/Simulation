# Bulk career QA

- Careers: **100**
- Seed: `20261027`
- Max seasons / career: 16

## Severity totals

| Severity | Count |
| --- | ---: |
| critical | 463 |
| high | 7 |
| medium | 0 |
| info | 7 |

## Free-agent soft-lock (UI animation gap)

- Careers that hit free-agent soft-lock payload: **100**
- Soft-lock events: **463**

Root cause (confirmed in code): `simulateSeason` free-agent path returns `{ season, freeAgent: true }` without `league`/`standings`. `showSeasonAnimation` → `animateSeasonSequence` early-returns after opening the overlay and **never calls `onContinue`**, leaving the UI stuck.

## Senior scenario overall impact

- Resolves: 0
- Current-OVR moved: 0
- Current-OVR flat: 0

## Goalkeeper attribute shape

- GK careers with GK keys present: 0
- GK careers missing GK keys: 7

Model already defines Reflexes / Handling / Positioning / Diving / Kicking / Physicality. Legacy `STATS_KEYS` in `playerConfig.js` remains outfield-shaped.

## Top finding codes

- `free-agent-ui-softlock`: 463
- `gk-missing-gk-attrs`: 7
- `gk-dual-attr-systems`: 7

## Sample critical findings

- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA0-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA1-CB): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA2-RM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA2-RM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA2-RM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA2-RM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA2-RM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA3-GK): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA3-GK): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA3-GK): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA3-GK): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA4-RW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA5-LW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA5-LW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA5-LW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA5-LW): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA6-ST): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA6-ST): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA6-ST): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA6-ST): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA7-CDM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA7-CDM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA7-CDM): Free-agent wait season would soft-lock the UI
- **free-agent-ui-softlock** (QA7-CDM): Free-agent wait season would soft-lock the UI
