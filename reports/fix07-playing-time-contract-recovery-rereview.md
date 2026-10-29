# Fix 07 re-review completion report

**Playing-time assessment, contract continuity and free-agent recovery — follow-up after CHANGES REQUIRED at 2515e95**

Prepared 2026-10-29. Branch: `fix/07-playing-time-contract-free-agent-recovery`.

## Identity

| Item | Value |
| --- | --- |
| Original accepted base (Fix 06) | `8313f27167c18c18079471a44b36878bd347638a` |
| Previous review commit | `2515e95073a8634871443b591802d2ed2ee49612` |
| Branch | `fix/07-playing-time-contract-free-agent-recovery` |

Final commit / remote SHAs are recorded in the re-review package `manifest.json` after push.

## Closed findings

### R1 — Pending contract review gate
- `simulateSeason` returns without aging/fixtures when `assertPlayableRegistration` reports `pending-review`.
- `selectNextCareerAction` exposes `resolve-contract-review` with `canSimulate: false`.
- Successful alternative-club accept settles the prior employer's pending review atomically; new registration is playable.
- Free-agent spell creation is blocked while a boundary review is pending.

### R2 — Renewal authority
- Released / missing-employer renewals rejected before finance booking.
- Terminal journal statuses (`declined` / `expired` / `superseded` / `accepted`) are not overwritten to `pending` on same-window regenerate.
- Post-season `generateTransferOffers` / `finalizeCompletedSeasonUi` route through `reviewPhase: "boundary"` when a pending boundary review owns the tray.

### R3 — Live club evidence
- `evaluateSquadDecision` passes the current playing club explicitly.
- Assessments ignore a prior club's season sample when evaluating the live club.

### R4 — Legacy scoping
- Period/club membership must be proved; literal `"old"` special-casing removed.
- Combined club+international minutes are not divided by league-only capacity; club-only minutes preferred.

### R5 — Extra-time capacity
- `fixtureOpportunityCapacity` derives 120 from actual ET (`decidedBy` / ET fields), independent of the user's minutes.
- Propagated to ledger `availableMinutes` / `matchDuration` for substitutes and zero-minute eligible players.

### R6 — Free-agent window identity
- Scheduled window ID no longer embeds ordinary/recovery.
- Closing freezes that window; regenerate without time advance returns the frozen closed result.
- Recovery applies only on a later scheduled search (new season index after wait).

### R7 — Browser harness
- B01–B07 assertions hardened (loan/options evidence, UI terminal review, required recovery Accept, non-retiring empty waits, real duplicate-accept check, no swallowed desk asserts).
- Browser execution status recorded honestly in the package (may remain BLOCKED if Chrome cannot launch).

## QA

- Appendix A independent probes: **9/9 PASS** (were 9/9 FAIL on 2515e95).
- Focused suite: **37/37 PASS**.
- Fix 07 full audit: **48 ordinary + 8 dedicated PASS**.
- Fix 06 / Fix 05 audits: PASS.
- Full `node --test tests/*.test.mjs`: **110 pass / 1 failed file** (`tests/playerAbility.test.mjs` — same two documented ability assertions).
- Browser: see package `qa/` evidence.

## Constraints preserved

No retune of ratings, awards, growth, injury, or OVR calibration. Fixes 01–06 ancestry retained. No merge/deploy/Fix 08.
