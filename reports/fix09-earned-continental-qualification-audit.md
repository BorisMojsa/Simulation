# Fix 09 audit — 1203cfe ReReview follow-up

## Scope

Continue Fix 09 on `fix/09-earned-continental-qualification` from `1203cfe`. Do not open Fix 10. Preserve R6 and Premier League controls.

## Appendix A controls (repaired)

| Control | Before (1203cfe) | After |
| --- | --- | --- |
| Half-played EPL (19/20/37) | Accepted as complete via fixtures-count | Rejected: appearances must be `2×fixtures`; per-club coverage enforced |
| Uneven per-club coverage | Accepted | Rejected without registry mutation |
| Full 38-match EPL | Qualified | Still qualifies (positive) |
| Oracle empty `sourceResults` | Passed via table fallback | `missing-source-results` |
| Null score rebuild | Coerced to 0 | Rebuild rejected |
| Target participation field IDs | Required annotated `p.competition` (false fails on real fields) | Club-ID presence + campaign competition / DNQ checks |
| Paired F01/F02/F03/F05/F10/F15 | Missing | Archived under `qa/fixtures/paired-controls/` |

## Browser journeys

| Case | Evidence |
| --- | --- |
| B02 | January Arsenal→Brentford retained; off-season `2026-07` acceptance + destination season + fresh restore |
| B04 | Arsenal→Brentford DNQ loan + return; reverse Brentford→Arsenal loan; Twente cross-association loan |
| B06 | Both branches `freshRestore` the same mid-season pause; world/RNG/`clubFinance`/pendingOffers/decision/stints/seasons equal |

## Residual allowance

Full suite: 164 pass / 1 failed file — only the two established `playerAbility` assertions.
