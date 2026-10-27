# Bugs found during career QA playthroughs

Source: browser playthroughs + full careers through real `simulateSeason`  
(`scripts/qaBulkCareers.mjs`, `scripts/qaCareerOutcomes.mjs`), plus focused integrity probes (2026-10-27).

Companion outcomes:
- Pre-retune 100 careers: `career-outcomes-2026-10-27T21-44-59-714Z.md`
- Post-retune 250 careers: `career-outcomes-latest.md`

---

## Critical

### 1. Free-agent “Train / search” soft-locks the UI
- Every full-career batch hits free agency; soft-lock payload hits: **766** (100 careers) / **1825** (250 careers).
- Wait/train advances age via `advanceFreeAgentPeriod`, but season payload is `{ season, freeAgent: true }` with **no `league` / `standings`**.
- UI: `showSeasonAnimation` early-returns; **`onContinue` never fires**.
- Code: `js/simulation/seasonSimulator.js` + `js/ui/seasonAnimation.js`
- Screenshot: `qa/screenshots/qa-08-free-agent-softlock-confirmed.png` · repro: `qa/repro-free-agent-softlock.html`

### 2. Individual awards never appear
- **0** award wins / Ballon-equiv across 100 and 250 full careers; elite probes also empty.
- Root cause: synthetic rivals dominate (`individualAwards.js`); user rarely clears `potsMetric > 0` + shortlist rank.
- Rival goal pots often ~20–31 vs user ~7–11 on strong seasons.

---

## High

### 3. Long free-agency stretches with no offers
- Multi-season FA with empty markets common (174 → 423 journal events across batches).

### 4. Champions League / Europe mid-tier realism
- `preSeasonContinentalStanding` seeds Europe by club overall when no prior finish (≥80 → CL). Palace/Brentford/Bournemouth open in CL; Ipswich can open in Europa while finishing ~17th.
- PL ratings compressed (City→Bournemouth ~10 OVR; Tottenham below Palace/Brentford).
- Sampled CL winners/finalists included Bournemouth, Brighton, Brentford, Freiburg, Augsburg, Como, Bodø/Glimt.

### 5. Superstar barely boosts weak clubs
- `playerLineupImpact`: 95 OVR at Hull (~70) → **+0.62** club OVR; Palace +0.43; City +0.11.
- Soft-capped by design; does not push mid-tiers toward elite contention.

### 6. Peak / final overalls too low for “star” careers
- Pre-retune peaks: avg **65.7**, max **79.9**
- After growth retune (opportunity floors ↓, caps/performance ↑, young knots ↑): peaks avg **66.0**, max **83**; ≥85: **0**, ≥90: **0**
- Isolated good seasons can still +5–7; random career paths under-deliver minutes/performance.

---

## Medium

### 7. Flat club unit strengths in database
- **572/572** clubs: ATK = MID = DEF = GK = overall exactly.

### 8. World Cup group W vs tournament wins (UX)
- Bracket data matched player matches when fully revealed.
- Group table W is group-stage only → deep runs still show e.g. W=2 while winning 6–7 games total.

### 9. Academy clubs missing `clubId` / finance profile
- Console spam: academy `clubId` / overall undefined.

### 10. Parent promote can fail / stuck-in-academy
- Promote can leave “X Academy” with near-zero apps; journal `stuck-in-academy` hits in 250-run.

### 11. Academy offer pools often all home-pathway
- Many careers get three same-nation academy doors only.

---

## Low / known

### 12. Goalkeeper attribute UX
- Engine has GK keys after finalize; legacy outfield-shaped UI/config still needs a dedicated pass.

---

## Growth retune already applied (2026-10-27)

Config in `js/config/playerDevelopmentConfig.js` (+ breakthrough annual cap wiring in `playerDevelopmentModel.js`):
- Opportunity floors 0.12 / youth 0.18
- Annual cap 8; breakthrough 9; stronger performance multipliers
- Young learning knots bumped; soft difficulty from 88; floor at 99 = 0.28
- No fixed personal potential reintroduced

Batch peaks barely moved — next work is path/minutes/roles/FA market, not only caps.

---

## Journal counts (latest 250-career flush)

| Code | Events |
| --- | ---: |
| `flat-club-unit-strengths` | 2371 |
| `free-agent-ui-softlock` | 1825 |
| `long-free-agency-no-offers` | 423 |
| `academy-home-pathway-only` | 56 |
| `stuck-in-academy` | 4 |
