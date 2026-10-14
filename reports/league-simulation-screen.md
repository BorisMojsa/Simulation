# League simulation screen — implementation report

**Date:** 13 October 2026  
**Prompt:** Fast match columns and a live league table  
**Delivery model:** Segmented live dashboard (sim runs to next pause/complete → animate committed fixtures → await choice → resume with reveal cursor)

## What shipped

| Area | Change |
| --- | --- |
| Data | `season.leagueAllMatches` / return `leagueAllMatches`; pause payloads expose `partialLeagueAllMatches` / `partialLeaguePlayerMatches` |
| Table rebuild | [`js/simulation/leagueTable.js`](../js/simulation/leagueTable.js) — `rebuildTableFromMatches`, score path, contribution formatting |
| Competition adapter | [`js/simulation/leagueEditionAdapter.js`](../js/simulation/leagueEditionAdapter.js) — bounded `commitMatch` for domestic editions |
| Shared standings UI | `renderLeagueTable` in [`js/ui/rendering.js`](../js/ui/rendering.js) with P / W / D / L / GF / GA / GD / Pts |
| Dashboard | `#simulation-dashboard` in `index.html` + styles; controller in [`js/ui/simulationDashboard.js`](../js/ui/simulationDashboard.js) |
| Season flow | `main.js` opens dashboard on pause segments; reveal cursor on `player.simRevealCursor`; completed seasons continue the same rail |

## Match reveal timing

| Phase | Default (1×) |
| --- | --- |
| Intro | 0–250 ms |
| Progress + score path | 250–1750 ms |
| Lock + hold | 1750–2500 ms |
| **Total per player card** | **2500 ms** (`DEFAULT_MATCH_MS`) |

Speed control cycles 1× / 2.5× / 5× and only scales view waits — seed, results, development, and selection are untouched. Skip match / Skip remaining still commit final scores and table updates.

## Acceptance mapping

- Automatic 2–3 s player cards with real (or deterministic cosmetic) score reveals — yes  
- Player contribution + match rating on each card (striker / GK / non-appearance) — yes  
- Full league fixtures simulated; background matches update the table without 2.5 s each — yes  
- Live right-side table with P/GF/GA and row motion — yes  
- Decision pause shows standings-to-date then resumes from reveal cursor — yes (segmented)  
- Reopenable career standings use the same full-column renderer — yes  

## Tests

```bash
node tests/leagueSimulationDashboard.test.mjs
node tests/browserFlowSmoke.test.mjs
```

Behavioral coverage includes table idempotence, goal-total balance, monotonic score paths, contribution formatting, `leagueAllMatches` on complete seasons, and partial fixtures on pause.

## Visual verification notes

Live checks against `http://127.0.0.1:8787` with Emulation device metrics (seeded dashboard shell, not a full career sim run):

| Width | Observed |
| --- | --- |
| 1440px | Split grid **62.3% / 37.7%**; horizontal card rail; 320px cards; table visible with 8 rows |
| 768px | Stacked single column; `railFlex: column`; no page-wide overflow |
| 390px | Stacked; cards full-width; table header min-width 520px scrolls inside panel; no page-wide overflow |

**Also verified in DOM:** Pause / 1× / Skip match / Skip remaining controls; competition tabs (League, Domestic cup, Continental, National team, Season recap).

**Source-level (not fully exercised in this browser pass):**

- Badge `onerror` fallbacks for standings and match cards  
- Event feed hidden by default (`match-details-drawer`)  
- Loan biography density / transfer max-height / misleading cup finish text remain owned by loan/competition prompts  
- Full seeded season playback (38 cards × 2.5 s) not timed end-to-end in-browser this pass  

**Measured reveal duration:** 2500 ms at 1× (`DEFAULT_MATCH_MS` in `simulationDashboard.js`).

## Follow-up QA (13 Oct evening)

Fixes after live play feedback:

1. **Match cards** are a vertical column; newest game prepends on top (`rail.prepend`).
2. **Competition tabs** (Domestic cup / Continental / National) removed from the live league dashboard so they cannot flicker over league playback. Cup and continental still run as their own phases afterward.
3. **Skip match / Skip phase** for cup & continental were broken because dashboard reused those button IDs and left `-legacy` controls unwired. Dashboard now uses `sim-skip-*`; cup/continental use `match-skip-*` inside the match-viewer header (visible under the title).

Browser QA (Emulation): 17/17 DOM contract checks passed; Coppa Italia viewer screenshot confirms Skip match / Skip phase in-header and clickable. Contract tests: `node tests/simulationDashboardUi.test.mjs`.

## Interface for competition prompt

Domestic dashboard currently treats `leagueAllMatches` + `rebuildTableFromMatches` as UI truth. When editions are fully registered, `leagueEditionAdapter.ensureLeagueEdition` / `commitLeagueMatchResult` already write into `competitionStore` with stable `matchId`s.
