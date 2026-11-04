# Fix 11 full-career growth completion

Final SHA: `pre-commit`

## Delivered

- Corrected R1–R4 accounting and monotonicity defects.
- Aligned `expectedRating` with the production `6.0` match-rating baseline.
- Calibrated age curves, elite difficulty, performance multiplier, and
  breakthrough eligibility while retaining the 8 / 9 caps.
- Added deterministic controlled, trajectory, natural-career, paired, witness,
  browser, package, verifier, and negative-control evidence.
- Preserved natural, constructed, and synthetic evidence as separate classes.

## Acceptance evidence

The focused growth suite reports 36 tests, 36 passed, zero skipped or failed.
The natural rarity and full-career summaries pass every hard and rarity gate.
Natural +6, +7, and displayed-99 witnesses are replayable by career ID and seed.

The browser report is `qa/fix11-runs/browser/browser-report.json`. B03/B04 use
replay-derived authoritative slim snapshots because replaying decades of full
match presentation is impractical; each snapshot records career, seed, policy,
season, and exact raw endpoints.

## Review package

The package script builds
`11-Full-Career-Growth-Calibration-Review-<shortsha>/` and a matching ZIP. It
contains tested source bytes, curated QA, reports, checksums, source manifest,
re-derived evidence, and a standalone verifier. Until the parent commits, the
manifest intentionally records the current HEAD plus dirty tracked and
intentional files.

No commit or push was performed during completion QA.
