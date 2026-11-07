# Fix 12 completion — second re-review

Updated: 2026-11-07T05:44:08.291158+00:00

## Outcome

READY after closing remaining R1/R2/R4/R5 items from the 53c32afe findings.

## Changes

| Finding | Repair |
| --- | --- |
| R1 | Single live-record banner upsert; stage-first batch sort; same-date stage keys; B01 single-banner + Final-row asserts |
| R2 | Declared legIds vs unique recovered legs; sparse opening vs saved phase → partial + withhold total |
| R4 | Real #continue-btn flows; two-leg UCL total; knockout ET/pens view; historical highlight; season switch; keyboard tab change |
| R5 | Required browser observation keys; source byte identity; parity pairDigests; style.css fingerprint; three independent negatives |

## Suites

- Focused: 19
- Maintained: see full-suite.txt
- Browser: 8/8
