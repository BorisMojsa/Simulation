# Fix 05 QA report

## Status: PASS with documented pre-existing suite failures

Base: `1a232dddc38626b89151bb572814de1caac9c522` (Fix 04 tip)  
Branch: `fix/05-match-participation-evidence-ledger`  
Node: v22.19.0 · Chrome via playwright-core · `python3 -m http.server 8000`

## Acceptance matrix

| Gate | Result |
| --- | --- |
| Zero-minute events/ratings (100× roles×sides) | PASS — 0 violations |
| Knockout event=stat (1000 draws; ET/pens exercised) | PASS — 0 violations; ET≈99; pens≈75 |
| Witness seeds 6/169/462 | PASS — events agree with stats |
| Ledger metadata / null rating / CS | PASS |
| Pre-kickoff training injury | PASS |
| Chronological seasons (20) edition+goal reconcile | PASS |
| Focused test file | PASS |
| Full `tests/*.test.mjs` | PASS except `playerAbility` baseline |
| Browser checklist | PASS (see cases) |

## Pre-existing suite failures (unchanged)

`tests/playerAbility.test.mjs`:

1. `development: annual cap, deconditioning is recoverable` — learning `8.693485869706887`
2. `academy growth mutates attributes and charges shared annual allowance`

## Browser cases

| Case | Status | Notes |
| --- | --- | --- |
| Unused / not selected / injured labels | PASS | Finished-season debug: 14 unused_sub, 22 not_selected, 1 injured; cards unrated |
| Positive contribution path | PASS | Season totals minutes/goals/assists after Skip season |
| Move / loan | PASS | ownership-transfer + live-loan fixtures |
| Skip match/phase/season + Continue | PASS | |
| Free-agent / academy predecessor | PASS | |
| Knockout ET/pens interactive playback | ENGINE+UI partial | Engine cohort required; UI finish did not isolate a live ET card |
| Keeper awards UI | ENGINE | Keeper chronological cohorts reconcile CS ledger↔raw |

Screenshots: `qa/screenshots/checklist-match-participation/`  
Structured: `qa/fix05-runs/`

## Commands

```text
node tests/matchParticipationEvidence.test.mjs
node scripts/qaMatchParticipationEvidence.mjs
# each tests/*.test.mjs via node
BASE_URL=http://127.0.0.1:8000 node scripts/browserMatchParticipationChecklist.mjs
```
