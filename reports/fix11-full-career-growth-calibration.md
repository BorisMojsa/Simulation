# Fix 11 full-career growth calibration

Final SHA: `pre-commit`

## Outcome

The production career flow now supports visible development without making
elite outcomes routine. Frozen caps remain 8 ordinary / 9 breakthrough raw OVR.
Displayed annual gain is `round(after) - round(before)`.

## Final evidence

- Controlled (250 each): poor median `0.3814`, ordinary `2.7141`, good `5.0151`.
- Good cohort: 70 displayed +6/+7 seasons; exceptional cohort: one.
- Natural mixed policy (200): median peak `81.4479`, p95 `94.9833`, p99
  `98.1365`, no displayed 99.
- Natural discovery witness run (250): one displayed-99 career (`0.004`), none
  before age 25 and none raw 99.
- Paired environment treatment (240): median effect `1.3174`, mean `1.3410`.
- Synthetic trajectories (10,000): median peak `80.1002`, p99 `94.7140`, max
  `98.3353`.

All assessed runs report finite values, zero reconciliation failures, zero cap
failures, zero false completions, and zero blocked careers.

## Natural witnesses

- `cid_2369bc62`: displayed +6 at age 21.
- `cid_2e1ba005`: displayed +7 at age 17.
- `cid_85a7b61e`: start raw `70.7225`; crossed displayed 99 at age 32 with raw
  `98.66995`.

Node replay exported authoritative slim before/after snapshots. Browser cases
B03/B04 import those snapshots and verify their endpoints and provenance; Node
replay remains the proof of the intervening production season.
