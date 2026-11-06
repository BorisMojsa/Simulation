# Fix 12 audit — Tournament presentation and win totals

**Date:** 6 November 2026  
**Repository:** `BorisMojsa/Simulation`  
**Accepted base:** `fa1445c731335e20d21f93cc412f451d2c77889d` (`fix/11-full-career-growth-calibration`)  
**Working branch:** `fix/12-tournament-presentation-win-totals`  
**Worktree:** `/Users/mojsa/Desktop/Simulation/.worktrees/fix12`  
**Node:** v22.19.0  
**Browser tooling:** Google Chrome at `/Applications/Google Chrome.app/...` + `playwright-core` (npm install --no-save pattern from prior checklists)

## Preflight

| Check | Result |
| --- | --- |
| `git status --short --branch` | Clean on `fix/12-tournament-presentation-win-totals` |
| HEAD | `fa1445c731335e20d21f93cc412f451d2c77889d` |
| Ancestry | Branch created exactly from accepted Fix 11 commit |
| Accounting controls | `controlled four-win accounting` + `N01 controlled` → **2 passed** |
| Full suite `node --test tests/*.test.mjs` | **227 passed, 0 failed, 0 skipped** |

Unrelated work on the main checkout (`fix/05-…`) and other worktrees was left untouched.

## Call paths

| Surface | Entry | Issue |
| --- | --- | --- |
| Career competitions overview | `renderCompetitions` → overview | Opening phase falls through to `"Knockout"` because national `groups` is an **array** (no `openingLabel`). Shows “Player path rounds / Bracket rounds” without P/W/D/L totals. |
| Career phase tab | same | Compact national tables show Pts/GD only; no phase-scope caption. |
| Career fixtures tab | same | Dedupes mixed projections including aggregate parents. |
| National recap | `showInternationalCompetitions` / `buildIntlDetailHtml` | Result/winner shown; no group-stage vs total tournament record. |
| Continental recap | `showEuropePath` | League-phase table present; no separate whole-tournament record beside it. |
| National playback | `buildNationalPlaybackContext` → `runSimulationDashboard` | `stageMode: "bracket"` whenever completed groups + KO exist, even with zero revealed fixtures. |
| Continental playback builder | `buildContinentalPlaybackContext` | Uses `leaguePhase.complete` (schema seam: projection exposes `frozen`/`provisional`). Currently unwired in season animation. |

Protected engines (`accountNationalTable`, `buildTableFromFixtures`, store commits, formats) remain the source of truth for phase arithmetic. Presentation must recompute display records from raw fixtures without calling `commitMatch`.

## Participant identity

- **National:** fixtures use nation **name** strings in `homeParticipantId` / `awayParticipantId` and `home.name` / `away.name`. Tables key rows by `name`. Scope participant = displayed nation (prefer campaign `playerNation` / selected nation, not live `player.club`).
- **Continental:** clubs keyed by `clubId || name` (`clubKey`). Historical stats belong to `focusClubId` / campaign focus club — not today's `player.club` after a transfer.
- Team records include bench/unavailable team games; they are not personal appearance tallies. Non-selected nation campaigns keep “Not in squad” / not-selected status while still allowing a labeled nation record when inventory exists.

## F01 reproduction (seed 12001, Serbia, 48-team WC)

Recipe: `prepareNationalEdition` → `drainNationalEdition` with the prompt’s player-match processor (2 group wins, 1 draw, 5 KO wins); background matches use the engine.

| Scope | P | W | D | L |
| --- | ---: | ---: | ---: | ---: |
| Group stage (table row) | 3 | 2 | 1 | 0 (Pts 7) |
| Whole tournament (nation fixtures) | 8 | 7 | 1 | 0 |

Observed overview fallback: **Opening phase: Knockout**. Player path rounds: 5. Bracket rounds: 6 (includes Third-place match — not a Serbia game). Result: **Winners**.

Raw Serbia fixture IDs retained under `qa/fix12-runs/baseline/f01-reproduction.txt`.

## Fixture inventories

| Campaign kind | Phase inventory | Whole-tournament inventory | Notes |
| --- | --- | --- | --- |
| National | `groups[].matches` (array of groups) | `fixtures` map / played fixtures involving nation; KO also in `allRounds` / `playerMatches` (subsets) | Dedupe by `matchId`. Placement round exists in bracket even if nation did not play it. |
| Continental league-phase | `leaguePhase.matches` | Phase + KO legs from `allRounds` (expand `legs`; exclude `isAggregate` / byes) | Aggregate card is not a third game. |
| Continental groups | `groups.groups[].matches` / `groups.matches` | Same KO expansion | Conference League uses 6 opening matches per format definitions. |

Completeness: a `complete`/`frozen` status or full `field` does **not** prove every historical raw leg is present. Partial inventories must surface as partial/unavailable, never as an exact total.

## Proposed display contract

1. Shared pure module `js/ui/tournamentPresentation.js`: collect → dedupe → tally → label; immutable; no simulation.
2. Explicit scope: `{ competitionId, editionId, participantId, participantKind }`.
3. Separate **phase record** and **total tournament record**; shootouts tracked separately from W/D/L (match goals after ET, excluding pens).
4. Stage labels via one shared map (League phase / Group stage / Round of N / … / Third-place match); preserve competition-specific `R1` → Round One.
5. Live summaries filter by revealed fixture IDs; completed history uses full stored edition.
6. Overview/recap HTML shows labeled records and phase-scope captions; round counts clarified so they cannot be read as games won.
7. Playback `stageMode` derived from revealed KO fixtures; continental builder treats `frozen` as opening-complete.

## Chosen participant for F01

Serbia (`nationality: "Serbia"`), World Cup 2026 edition, seed `12001`, called up, force-included.