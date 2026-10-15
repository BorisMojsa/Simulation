# Contract lifecycle QA report

**Base revision tested:** `f1c848c976aa3678c3b1814913b2534bcc3def93`  
**Implementation:** uncommitted working tree on `main` (this report).  
**Lifecycle versions:** `CONTRACT_LIFECYCLE_VERSION = 1`, `TRANSFER_SAVE_VERSION = 2`, `DEAL_PIPELINE_VERSION = deal-pipeline-v2`, checkpoint `version = 2`.

## Renewal policy

`evaluateRenewalReview()` in `js/simulation/contractLifecycle.js` is the single authority.

| Outcome | When |
| --- | --- |
| `undecided` | Outside final year (`rem > 1`), academy, or no employer |
| `wants-renewal` | Interest &gt; 0.3 and role not surplus (or depth cover for capable players); finance probe OK |
| `temporary-reject` | Club would renew but affordability/terms fail — **not** a firm non-renewal announcement |
| `will-not-renew` | Age decline, surplus role + low interest, or insufficient interest |

Generation (`generatePipelineOffers`) and squad UI (`evaluateSquadDecision`) both read this review. Missing `renewalPlanned` never invents non-renewal. Temporary finance rejection never sets `renewalPlanned = false`.

## Expiry / time semantics

- Integer half-open interval: `contractEndSeason = N` is active while `seasons.length < N`.
- Example: `contractEndSeason = 1` covers only the first season; after that season completes, the contract is expired.
- `applyContractExpiryAtBoundary()` runs after season history is written under the clubs actually represented, then releases employment/playing registration and wages once via `releaseToFreeAgency()`.
- Free-agent seasons use `advanceFreeAgentPeriod()` — aging/training without old-club fixtures.
- Legacy players with a club but no term remain playable until migrated/released (unknown term ≠ already expired).

## Finding map (A–T)

| ID | Status | Notes / references |
| --- | --- | --- |
| **A** Renewal vs non-renewal contradiction | **Fixed** | `contractLifecycle.evaluateRenewalReview`; `dealPipeline.generatePipelineOffers`; `squadDecisions.evaluateSquadDecision` |
| **B** Contracts expire numerically not operationally | **Fixed** | `seasonSimulator.applyContractExpiryAtBoundary` after history; free-agent path in `simulateSeason` |
| **C** Null club crashes free agency | **Fixed** | Free-agent engine path; `helpers.clubNameForDisplay` → “Free agent”; `describeRegistration`; `playerEligibleForClubMatch` gated |
| **D** Accept leaves pending discussion | **Fixed** | `consumeRelatedDecisionAfterDeal`; `finishOfferWindow` / `applyTransfer` clear related decision |
| **E** See-out leaves offers unresolved | **Fixed** | `declineWindowAndContinue`; stay resolves offers; see-out clears window |
| **F** Duplicate-click guard blocks later deals | **Fixed** | `dealBookingGuard` scoped to offer/window key; cleared after success/failure |
| **G** Loan renewal targets borrower | **Fixed** | Renewals use `resolveEmploymentClub`; `applyRenewalTerms` preserves borrower registration |
| **H** Loan endings UI-dependent | **Fixed** | `simulateSeason` settles expired loans at boundary; decision paths settle before new-loan/sale |
| **I** Purchase bypasses validation/booking | **Fixed** | `endLoan('purchase')` pre-validates affordability then `acceptPipelineOffer` |
| **J** Reaccepting loan mutates twice | **Fixed** | `startLoan` idempotent via active-loan / `consumedTransitionIds` / booking duplicate |
| **K** Loan settlement leaves slots/wages | **Fixed** | `settleLoanSlotsAndWages` on return/recall/expiry/purchase |
| **L** Stale offers executable | **Fixed** | `isOfferExecutable` + offer journal + employer/revision/career checks |
| **M** Checkpoint finance wipe | **Fixed** | Deep-clone `exportClubFinanceState`; ordinary resume skips finance import (`restoreFinance` only) |
| **N** First-pro fallback bypass | **Fixed** | `signFirstProfessionalContract` returns structured `{ok}` only; no unsigned apply path |
| **O** World-state module split | **Fixed** | `main.js` imports `worldState.js` without `?v=` so setup/engine share one singleton |
| **P** Invalid decision choices accepted | **Fixed** | `resolveSquadDecision` checks `allowedChoices` before cooldown side effects |
| **Q** Story eligibility forced | **Fixed** | `handleSeniorScenarioEvent` builds truthful loss/rival/congestion/leave from runtime state |
| **R** Fixture double-booking | **Fixed** | `buildRoundRobinRounds` / `flattenRoundRobinFixtures` + matchday-dated calendar |
| **S** Pause changes seeded outcomes | **Fixed** | Checkpoint stores `selRngState`/`injuryRngState`; resume restores streams (not `:resume` reseed) |
| **T** Presentation labels | **Fixed** | Nationality vs international; employer/loan/wage/free-agent labels; sync simulate button from `selectNextCareerAction` |

## Tests

All `tests/*.test.mjs` run independently (Node). **18 files, all exit 0.**

| File | Exit | Notes |
| --- | --- | --- |
| `tests/contractLifecycle.test.mjs` | 0 | 13 scenarios: review, expiry, free agent, stale offer, fixtures, loans, purchase stress |
| `tests/transferLoanFollowup.test.mjs` | 0 | Handles `awaitingDecision` **and** `awaitingScenario` in bounded loop |
| `tests/transferLoanPipeline.test.mjs` | 0 | Migration version 2 |
| `tests/browserFlowSmoke.test.mjs` | 0 | Structured first-pro result |
| `tests/careerFlowSmoke.test.mjs` | 0 | Structured first-pro result |
| Remaining 13 existing files | 0 | Unchanged expectations still pass |

Commands (from repo root):

```bash
for f in tests/*.test.mjs; do node "$f"; done
```

## Before / after evidence

### Screenshot contradiction (A)
- **Before (audit):** Atalanta renewal offer + Atalanta non-renewal notice together (`renewalPlanned` falsy).
- **After (browser CDP + UI):** `review: wants-renewal`, renewal offer present, decision kind `development-loan` (not `non-renewal`).
- Screenshot: `reports/screenshots/atalanta-renewal-coherent.png`

### Repeated rejection through expiry (B)
- One-season Atalanta contract, see-out / clear offers, three `simulateSeason` calls:
  - Season 1: played (history retained), then released (`wage: 0`, `club: null`)
  - Seasons 2–3: `matches: 0`, free agent, no old wage
- Screenshot: `reports/screenshots/free-agent-after-expiry.png`

### Borrower renewal (G)
- Engine: renewals resolve via `employmentClubId` / `resolveEmploymentClub`; `applyRenewalTerms` does not overwrite borrower `player.club` while loan active.
- Browser: live loan fixture loads Atalanta parent (`reports/screenshots/live-loan-fixture.png`). Full parent-renewal-during-active-borrower click path not fully exercised in UI this pass (covered by unit design + loan fixture load).

### Stale acceptance (L)
- Unit: `isOfferExecutable` rejects wrong employer; cloned renewal second accept fails.

### Booking / settlement (I/J/K)
- Unit: unaffordable GBP 100m / GBP 1m weekly purchase rejected; loan intact; duplicate loan rejected.

### Restored checkpoint finance (M)
- Export deep-clones ledgers; resume no longer imports pause finance over post-decision bookings. Full JSON round-trip still via `careerSnapshot`.

### Pause parity (S)
- Stream seeds serialized on checkpoint; resume restores. Interactive vs one-shot identical-choice invariant improved; not re-run as the full Chronology Parity QA calibration in this pass.

## Browser evidence

Served at `http://127.0.0.1:8765/`.

| Case | Result |
| --- | --- |
| App loads over HTTP | Pass |
| Final-year Atalanta coherent contract UI | Pass (screenshot) |
| Decline / expiry → free agent UI | Pass (screenshot) |
| Free-agent empty market message | Pass |
| `__loadLiveLoanBrowserFixture()` | Pass (screenshot) |
| Full academy → first contract click path | **Not fully walked** (CDP fixture used instead) |
| Accept two distinct windows sequentially in production handlers | **Not fully walked** (unit/handler coverage + guard fix) |
| Parent renewal during active loan in UI | **Not fully walked** |
| Purchase success/failure clicks in UI | Unit only |
| Senior scene multi-pause parity visual | Engine fix only |
| Narrow-screen layout pass | **Not verified** |

## Remaining / unverified

1. Interactive Chronology Parity QA (seed 42, four seasons) not re-executed end-to-end after RNG restore — unit/engine fix is in place.
2. Full academy career start through first-pro overlay not click-walked in this browser session.
3. Parent renewal while on loan and purchase option success not click-verified in production `main.js` handlers.
4. Cup/continental overlap after mid-season transfer not re-calibrated beyond existing tests.
5. `reports/nation-strength-coverage-report.json` may regenerate from unrelated tests; left clean in this tree.

## Post-audit follow-up

Exploration called out that `liveLoanBrowserFixture.js` treated `awaitingScenario` as `no-mid-season-pause`. Fixed: the fixture now skips senior-scene pauses (bounded loop) before requiring `awaitingDecision`. Re-verified `buildLiveLoanBrowserFixture({ seed: 7 })` → `ok: true`, `development-loan`, 3 offers; `tests/browserFlowSmoke.test.mjs` still passes.

## Essential acceptance

Rejecting every offer is allowed. After the signed contract ends, the player is a free agent: no old-club appearances, wage 0, overview shows Free agent / No club, and the market exposes train/wait/search rather than deadlock. Popups and buttons no longer claim non-renewal while showing a renewal for the same review.
