# Fix 09 audit — ebbe1d1 ReReview follow-up

## Scope

Continue Fix 09 on `fix/09-earned-continental-qualification` from `ebbe1d1`. Do not open Fix 10. Preserve R6 and Premier League controls.

## Appendix A controls (repaired)

| Control | Before (ebbe1d1) | After |
| --- | --- | --- |
| AFC regional known DNQs | 13 Saudi DNQs in 32-team regional field | 0 conflicts; earned Saudis retained; regional falls through when inventory infeasible |
| Zero-played full roster | migrated as completed CL | `unresolved`, registry untouched |
| Oracle wrong identity / label-only | ok true | ok false; valid source-complete still ok |
| New arrival at immutable focus | January league fixtures exposed | 0 late league-phase attachments |

## Appendix B source-match audit

| Metric | ebbe1d1 archive | Current cohort |
| --- | --- | --- |
| Correct played source editions | 14/42 | **42/42** |
| Wrong-year citations | 28/42 | **0** |

Root cause: chronological league events dropped `fixtureId` from the calendar builder, so every season reused yearless `${leagueId}:md:${index}` IDs. Fix preserves edition-scoped calendar IDs and stamps `editionId` / `sourceResults` on commit.

## Browser journeys

| Case | Evidence |
| --- | --- |
| B01 | Second season entry matches played finish competition/DNQ (not label-only) |
| B04 | Controlled Brentford loan via ownership loan fixture; DNQ borrower; return to parent CL |
| B06 | Real `awaiting_decision` mid-season pause; restore+finish tables/finance match uninterrupted branch |
| B07 | Brazil calendar-year rollover from played source table |
| B09 | FA search/train advances age/season, then post-search resign + destination season |

## Residual allowance

Full suite: 164 pass / 1 failed file — only the two established `playerAbility` assertions.
