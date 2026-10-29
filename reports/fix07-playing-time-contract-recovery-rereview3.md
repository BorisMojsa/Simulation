# Fix 07 re-review completion report (after b6b3ea5)

**Playing-time assessment, contract continuity and free-agent recovery — follow-up after CHANGES REQUIRED at b6b3ea5**

Prepared 2026-10-29. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Identity

| Item | Value |
| --- | --- |
| Original accepted base (Fix 06) | `8313f27167c18c18079471a44b36878bd347638a` |
| Prior reviews | `2515e950…`, `e9f914e0…`, `b6b3ea53…` |
| Branch | `fix/07-playing-time-contract-free-agent-recovery` |

Final commit / remote SHAs are recorded in the package `manifest.json` after push.

## Closed findings (remaining branches)

### R1 — Application finalizer parent-review ownership
- `finalizeCompletedSeasonUi` settles ended loans via `endLoan` **before** queuing loan-return when a pending parent `wants-renewal` review exists.
- Boundary tray remains the live decision; loan-return is not shown while parent renewal is executable.
- Appendix B parent-loan app-order probe PASS; maintained F13 regression.

### R4 — Legacy competition population
- Non-league club minutes subtract continental campaigns and every domestic cup campaign, with primary/campaign dedupe.
- Controlled continental and two-cup fixtures no longer promote mixed all-club/league shares.
- Appendix A competition-scope 4/4 PASS; maintained F12 regression.

### R7 — Browser boundary path, baseline clubs, Fix 06 snapshots
- B03 uses paused pre-completion fixtures; browser resumes, completes, clicks final Continue, and exercises Accept/Decline on positive and co-terminal paths (plus restore controls).
- Co-terminal Accept reuses the live pause snap so loan destination / minutes stay on the proven wants-renewal path.
- Baseline cohort resolves `leagueId`+`clubIndex` against senior clubs (objects, not IDs); fails fast; records 12 employed initials; separates measured vs unknown shares.
- Fresh Fix 06 checklist exports all 15 named `snapshotFiles` paths under `qa/fixtures/fix06` and `qa/fix06-runs/cases`.

R2, R3, R5 and R6 remain closed; preserved.

## QA (final working tree)

| Check | Result |
| --- | --- |
| Original 9 probes | PASS (exit 0) |
| Remaining-path + boundary-terms | PASS (exit 0) |
| Appendix A competition-scope | 4/4 PASS |
| Appendix B parent-ui-order | 4/4 checks PASS |
| Focused `playingTimeContractRecovery.test.mjs` | **41/41 PASS** |
| Fix 07 exporter | 48 ordinary + 8 dedicated PASS |
| Fix 06 / Fix 05 exporters | PASS |
| Full `node --test tests/*.test.mjs` | 114 pass / 1 failed file (`playerAbility` — same two baseline assertions) |
| Browser Fix 07 B01–B07 | PASS |
| Browser Fix 05 (incl. `live-et-pens-season-continue`) | PASS |
| Browser Fix 06 | PASS; 15/15 named snapshots present |
| Baseline cohort final | 48 records; 12 initial employed; 40 club seasons; measured mean share recorded separately from unknown/`none` |

## Constraints preserved

No retune of ratings, awards, growth, injury, or OVR calibration. Fixes 01–06 ancestry retained. No merge/deploy/Fix 08.
