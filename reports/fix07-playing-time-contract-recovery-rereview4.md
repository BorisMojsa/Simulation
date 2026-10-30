# Fix 07 re-review completion report (after e3734f7)

**Playing-time assessment, contract continuity and free-agent recovery — follow-up after CHANGES REQUIRED at e3734f7**

Prepared 2026-10-29. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Identity

| Item | Value |
| --- | --- |
| Original accepted base (Fix 06) | `8313f27167c18c18079471a44b36878bd347638a` |
| Prior reviews | `2515e95…`, `e9f914e…`, `b6b3ea5…`, `e3734f7…` |
| Branch | `fix/07-playing-time-contract-free-agent-recovery` |

Final commit / remote SHAs are recorded in the package `manifest.json` after push.

## Closed findings (remaining branches)

### R4 — Legacy uncertainty handling
- Unidentified cup overlap (no fixture/match IDs across primary + campaigns) marks subtraction incomplete.
- Missing minutes without a proved participation flag are uncertainty, not zero.
- Qualified continental campaigns with missing `playerMatches` are incomplete evidence.
- Explicit `leagueMinutes` remains usable even when unrelated cup rows are incomplete.
- Appendix A legacy-uncertainty probes **7/7 PASS**; maintained F14 covers all seven cases.

### R7 — Raw browser stages, baseline comparison, audit records
- B03 compact summary retained; **20 lossless raw stage files** under `qa/fix07-runs/cases/B03-stages/` with path links from `B03.json` (start / before-Continue / desk-before-choice / after-choice / final desk × positive+coterminal Accept+Decline).
- Continue-pair invariants asserted (age, history length, revision, wage, review identity).
- Corrected harness runs against accepted Fix 06 modules and final; `legacy-reported` vs opportunity shares distinguished; keyed 48-period comparison packaged.
- Full Fix 07 audit case records included in the review ZIP (not summaries only).
- Probe multi-value logs use `.jsonl` names.

R1–R3, R5–R6 remain closed; preserved.

## QA (final working tree)

| Check | Result |
| --- | --- |
| Appendix A legacy-uncertainty | **7/7 PASS** |
| Original 9 / remaining 4 / boundary-terms / prior A/B | PASS |
| Focused suite | **42/42 PASS** |
| Fix 07 / 06 / 05 exporters | PASS |
| Full Node suite | 115 pass / 1 failed file (same two ability assertions) |
| Browser Fix 07 B01–B07 | PASS (20 B03 raw stages) |
| Browser Fix 05 / 06 | PASS; Fix 06 named snapshots present |
| Baseline compare | 12/12 matched initials; 48/48 periods each side |

## Constraints preserved

No retune of ratings, awards, growth, injury, or OVR calibration. No merge/deploy/Fix 08.
