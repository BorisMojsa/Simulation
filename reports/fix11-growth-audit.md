# Fix 11 growth audit

Status: complete. Final SHA: `pre-commit`.

## Reproduction record

The first pre-fix probe matched the brief exactly. The tracked
`qa/fix11-runs/baseline/r1-r6-probe.json` was subsequently re-run after the
accounting fixes, so its current values are post-fix evidence. The brief's
pre-fix numbers are retained here to avoid rewriting the baseline history.

- **R1 — duplicate academy charge (accounting defect).** Before: a raw academy
  gain of `0.8500000000000085` was booked twice (effective carry `1.700000000000017`).
  After: the same gain is owned once by `applyAcademyGrowth`; the re-run records
  raw `62 → 62.85000000000001`, receipt `0.8500000000000085`, and imported use
  `0.8500000000000085`. The probe's legacy `doubleCharged` label describes the
  old assertion and should not be interpreted as a second post-fix debit.
- **R2 — recognition role weights applied twice (accounting/distribution defect).**
  Before recognition components were reduced to squared-weight totals: ST
  `0.21999999999999997`, CM `0.195`, CB `0.2898`, GK
  `0.18500000000000003` for a requested `1`. After water-filling, the re-run
  records `1`, `1`, `0.9999999999999999`, and `0.9999999999999999`.
- **R3 — high-OVR challenge transform (monotonicity defect).** The original
  transform could invert ordering below environment `1`. After the bounded
  monotone transform, the re-run at raw `97.99529145318878` records environment
  inputs `0.8 / 0.95 / 1` with effective values
  `0.7640282512808674 / 0.9393208870990074 / 1` and raw deltas
  `0.04787536507843981 / 0.09850431805708126 / 0.11602998272356047`;
  inversion is false.
- **R4 — positive shock omitted from the shared allowance (accounting defect).**
  Before the allowance reported only learning,
  `4.0195678626410976`, while gross positive was
  `4.182101552814852` (`4.0195678626410976` learning plus
  `0.1625336901737548` positive shock). After: the period ledger and
  `annualAllowanceUsed` both record `4.182101552814852`; net shock remains
  `-0.06430034311645014`.
- **R5 — previous calibration harness limitations (evidence defect).** The old
  harness mixed synthetic and integrated evidence, did not preserve true paired
  RNG state, used incomplete careers, and could treat unresolved season returns
  as progress. `scripts/calibrateFullCareerGrowth.mjs` and
  `scripts/lib/fix11GrowthEvidence.mjs` now separate evidence classes, clone
  player plus RNG state for twins, drain production pending lifecycles, and make
  failed acceptance executable.
- **R6 — stale cap assumptions and displayed-delta definitions (test/evidence
  defect).** Before evidence included learning plus recognition
  `8.695347691740297`, academy gains `2.000000000000007` then
  `5.999999999999993`, while an old assertion still assumed cap `7`. The
  production caps remain ordinary **8** and breakthrough **9**. Displayed +6/+7
  is now measured as `Math.round(after) - Math.round(before)`.

## Additional root cause: `expectedRating`

Production match ratings were generated around a `6.0` baseline, while
`leagueFixtures` and `playerMatchDay` assigned an expectation around `6.45`.
That systematic `-0.45` residual depressed `seasonP`, made ordinary careers look
poor, and suppressed both learning and breakthrough eligibility. The two
expected-rating paths and `PERFORMANCE.defaultExpectedRating` now share the
`6.0` baseline. The environment evidence path also prefers the season's
authoritative `context.clubOverall` over potentially stale player club data.

## Before / after

- Before: R1 and R4 over/under-accounted the shared allowance; R2 lost
  recognition through a second role weighting; R3 could invert environmental
  ordering; expected ratings systematically biased performance downward.
- After: exact gross-positive reconciliation, monotone challenge, one academy
  charge, full recognition distribution, aligned match expectation, and strict
  no-false-completion checks all pass.
- Final controlled medians: poor `0.3814`, ordinary `2.7141`, good `5.0151`;
  supported +6/+7 witnesses exist naturally.
- Natural rarity witness run: 250 complete careers, displayed-99 rate `0.004`,
  displayed 99 before age 25 `0`, and no raw-99 career.

## Frozen environment

- Node: `v22.19.0`
- Base SHA: `8d74769ec31b0e240f55414121d0a895d414304e`
- Final SHA: `pre-commit`
- Ordinary / breakthrough caps: `8 / 9`
- Target schema: `fix11-growth-v1`
- Displayed 99: `Math.round(baseOverallRaw) === 99`, equivalently raw `>= 98.5`

The targets and plan were frozen before tuning. Match-rating outcomes, awards,
injuries, club strength, transfer offers, and cap values were not altered;
`expectedRating` was corrected to the existing rating generator baseline.
