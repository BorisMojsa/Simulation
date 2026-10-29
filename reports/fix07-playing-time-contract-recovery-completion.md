# Fix 07 completion report

**Playing-time assessment, contract continuity and free-agent recovery**

Prepared 2026-10-29. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Identity

| Item | Value |
| --- | --- |
| Base (accepted Fix 06) | `8313f27167c18c18079471a44b36878bd347638a` |
| Branch | `fix/07-playing-time-contract-free-agent-recovery` |
| Predecessor ancestry | `git merge-base --is-ancestor 8313f27 HEAD` → yes (branched from that commit) |

Final commit / remote SHAs are recorded in the external review package `manifest.json` after push (not embedded here before commit).

## What changed

### Club opportunity assessment

- New module `js/simulation/playingTimeAssessment.js` defines club minutes / eligible capacity over ledger records (including available zero-minute fixtures).
- International fixtures excluded; unavailable/registration-ineligible fixtures are exclusions.
- Explicit numeric zero preserved (no `||` substitution from stale season totals).
- Cross-period / cross-club `player.seasonLedger` ignored with conflict diagnostics.
- `clubMinutesShare` and winter mid-season proxy share the same assessment contract.
- Completed seasons persist `playingTimeAssessment` + `participationLedger`.

### Squad / loan decisions

- Low-minute decisions require a usable assessment sample.
- Development loan recommendations use configured `loanDestinationMinMinutesShare` (0.5) and `loanMinutesImprovement` (0.2).
- Elective loan searches retain the broader 0.35 pool and are not advertised as development recommendations.

### Renewal continuity and boundary review

- Pre-expiry renewal extensions: `newEnd = max(previousEnd, completedSeasons) + extensionYears`.
- One-year extension from end 1 at completed 0 → end **2**.
- Distinct `reviewPhase: "boundary"` completed-evidence review before irreversible release.
- `pendingContractReview` defers expiry; `assertPlayableRegistration` blocks a new club season while pending.
- Engine `stay` / non-interactive paths auto-settle decline; interactive UI keeps the tray.
- `main.js` decline path settles boundary review through shared lifecycle.

### Free-agent recovery

- After one closed empty scheduled market review in a continuous free-agent spell, the next search bypasses the interest lottery and systematically inspects eligible clubs until a validated offer or exhaustion.
- Frozen review identity prevents reroll on render/export/restore.
- Declining a valid offer breaks the consecutive-empty streak (refusal, not empty).
- Legitimate empty markets remain possible when no valid destination exists.

## Before / after reproductions

| Probe | Before | After |
| --- | --- | --- |
| 900 min / 38 games | share 1 (apps×90) | 900/3420 ≈ 0.263 |
| 600 min / 38 games | share 0.667 | 600/3420 ≈ 0.175 |
| Explicit ledger zero + season 900 | used 900 | share 0 |
| Old `seasonLedger` | polluted share 1 | ignored; legacy standing estimate |
| Hull 58 seed 707 | 511/(17×90) ≈ 0.334 | 511/3780 ≈ 0.135 |
| One-year renewal end 1 | stayed 1 | becomes 2 |
| `bug07-search-0` then wait | empty, empty… | empty then recovery offers |

Baseline raw output: `baseline/fix07-baseline-repro.txt` (pre-fix) and after probes in completion QA logs.

## QA commands and results

Focused:

```bash
node tests/playingTimeContractRecovery.test.mjs   # 28 pass / 0 fail
node scripts/qaPlayingTimeContractRecovery.mjs    # 48 periods + 7 dedicated PASS
```

Required regressions (selected batch): 65 pass / 0 fail including contract lifecycle, transfer/loan, free-agent softlock, academy, injury, match participation, chronological, ownership, cross-league.

Predecessor audits:

```bash
node scripts/qaInjuryDevelopmentExposure.mjs      # PASS
node scripts/qaMatchParticipationEvidence.mjs     # PASS (loan probe destination-agnostic)
```

Pre-existing ability failures (unchanged):

1. `development: annual cap, deconditioning is recoverable` — `learning 8.693…`
2. `academy growth mutates attributes…` — `big.realized <= 7 - r.realized`

### Browser acceptance — BLOCKED

Commands attempted:

```bash
python3 -m http.server 8010 --bind 127.0.0.1
NODE_PATH=…/node_modules BASE_URL=http://127.0.0.1:8010 \
  node scripts/browserPlayingTimeContractRecoveryChecklist.mjs
```

Chrome/playwright launches then aborts with `kill EPERM` / `SIGABRT` in this agent environment (sandbox cannot manage the Chrome child). Harness script is present for local rerun:

- `scripts/browserPlayingTimeContractRecoveryChecklist.mjs` (B01–B07)
- Predecessor harnesses unchanged: `browserInjuryDevelopmentChecklist.mjs`, `browserMatchParticipationChecklist.mjs`

**Do not treat Fix 07 as browser-green until B01–B07 and Fix 05/06 browser checklists are executed on a machine that can launch Chrome.**

## Policy choices

- Recovery after **one** closed empty free-agent review (interest-gate or sample miss).
- Ordinary first search retains lottery uncertainty.
- Boundary renewal is a distinct review phase; early-season latch preserved within phase.
- Extension years are additive from the existing end boundary, capped by under-18/adult max coverage accounting for unexpired remainder.

## Limitations

1. Browser acceptance not executed in this environment (Chrome launch blocked).
2. Full `node --test tests/*.test.mjs` still carries the two documented ability failures.
3. Loan development gate (0.5) changes which destinations appear in the live-loan fixture vs Fix 06; edition-bucket tests/QA updated to be destination-agnostic.
