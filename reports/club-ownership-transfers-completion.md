# Fix 02 completion: Club ownership after transfers and loans

Prepared 27 Oct 2026 (America/Chicago). Follow-up after review of `8fc7060`.

## Baseline

- **Original base:** `9f87dee4303075517f0795a96d8a2a65a05f3801`
- **First Fix 02 commit reviewed:** `8fc7060af5e7d4c2102478ca1b91bb4ca37f871b`
- **Authority:** dated `player.playingStints` via [`js/simulation/playingRegistration.js`](../js/simulation/playingRegistration.js). Employment alone never authorizes a club appearance.

## Review follow-up (F01–F04)

| ID | Gap on `8fc7060` | Fix |
| --- | --- | --- |
| F01 | Undated accept skipped `recordPlayingTransition` → 0 destination league fixtures | `resolveDealSimulationDate` from career calendar; always record stint on permanent accept |
| F02 | Destination continental fixtures drained as world-only / tagged without ledger | Background drain clears player; attach requires matchProcessor; inject pending attached fixtures after move; finalize processes attached then drains |
| F03 | `dateCupRounds([{},{},{}])` dropped winter anchors; January dest cup impossible | Full six anchors for cross-association; `prepareDestinationCupContinuation` advances past rounds world-only once |
| F04 | Empty `season.trophies: []` fell through to `europeanCampaign.won` | Authoritative trophies array short-circuits; Europe path uses entitlement / attributed world win |

## Before → after (engine probes)

Reproduction: `node scripts/probeOwnershipBaseline.mjs`

| Probe | Before Fix 02 | After follow-up |
| --- | --- | --- |
| Arsenal → Brentford | 11 post-move Arsenal CL `playerMatches` | **0** post-move Arsenal continental `playerMatches` |
| Atalanta → Rudeš loan | 4 post-move Atalanta continental `playerMatches` | **0**; playing=Rudeš, employment=Atalanta |
| Free-agent signed (F01) | 0 league fixtures / 0 club apps on `8fc7060` | **34** league fixtures, club apps/minutes restored |
| In-field dest (F02, e.g. Crystal Palace) | Tagged playerMatches with **0** matching ledger IDs | Two-leg playoff path with ledger IDs; positive- and zero-minute cases |
| Jan cross-assoc cup (F03) | `destinationCupEvents: 0` | Jan/Mar/May anchors scheduled; continuation advances prior rounds without fresh January bracket |
| Trophy UI (F04) | `trophies: []` + `won: true` → personal CL trophy | Empty authoritative list → **no** personal celebration |

## Tests run

```bash
node tests/clubOwnershipTransfers.test.mjs   # 12 OK (8 original + F01–F04)
node --test tests/*.test.mjs                 # 70 pass, 1 fail
# FAIL tests/playerAbility.test.mjs — pre-existing growth-cap (same on base)
node scripts/probeOwnershipBaseline.mjs      # 0 post-move Arsenal / Atalanta leaks
```

## Browser acceptance

```bash
BASE_URL=http://127.0.0.1:8000 node scripts/browserOwnershipChecklist.mjs
```

| Case | Status |
| --- | --- |
| Cross-country loan → Rudeš | Done — playing + employment both asserted after resume |
| Arsenal → Brentford permanent | Done — trophies carry `winningClubId` |
| Free-agent signed fixture | Done — open destination stint present |
| Destination continental / delayed-reg UI | Engine regressions; not separately driven in UI |
| Loan-return UI | Engine-covered |

Screenshots: `qa/screenshots/checklist-ownership/`

## Limitations (not claimed complete)

- UEFA subsequent registration still blocks **league-phase** destination attach; knockout/playoff in-field destinations go through match-day + ledger.
- Contribution-based former-club medals remain possible when the player had positive minutes for the eventual winner before leaving.
- Fixes 03 (league membership after promotion/relegation) and 04 (academy) remain separate — do not start them here.
