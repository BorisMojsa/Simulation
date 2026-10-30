# Fix 07 re-review completion report (after b0ba581)

**Partial fixture-identity domestic cup overlap — follow-up after CHANGES REQUIRED at b0ba581**

Prepared 2026-10-30. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Closed finding

### R4 — Partial-identity cup overlap
- Domestic primary/campaign views are tracked per source.
- Multiple positive views with any unidentified contribution mark subtraction incomplete (suppress low-minutes).
- Fully identified multi-view cups still dedupe by fixture/match id (alias OK; distinct cups OK).
- Appendix A partial-identity probes **5/5 PASS**; maintained F15. Prior seven uncertainty cases remain green.

### R7 provenance
- Baseline comparator rerun after commit; `comparison.finalSha` matches the packaged final commit.

R1–R3, R5–R6 and verified R7 raw evidence remain closed.

## QA

| Check | Result |
| --- | --- |
| Partial-identity Appendix A | 5/5 PASS |
| Prior legacy uncertainty | 7/7 PASS |
| Focused suite | 43/43 PASS |
| Exporters Fix07/06/05 | PASS |
| Full Node suite | same two ability assertions only |
| Browsers Fix07/05/06 | PASS (retain 20 B03 stages + 15 Fix06 snaps) |
| Baseline compare finalSha | equals committed HEAD |

## Constraints

No retune. No merge/deploy/Fix 08.
