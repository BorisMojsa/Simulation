# Transfer / loan calibration

- Revision: `c3536363c19ec61e18b1b82e667cee4277fcbf7f` (dirty working tree)
- Scenarios: 936
- Runtime: 3644 ms
- Offers: 1130 (mean 1.21 / scenario)
- Eligible candidates (sum): 295332
- Elite SENIOR offers (all ratings): 5
- Elite SENIOR offers for ≤60 OVR fixtures: **0** (must be 0)
- Elite prospect pathway offers: 0
- Fee P50/P90: 12750000 / 22250000
- Wage P50/P90 weekly GBP: 6900 / 112000
- Loan start/return: 156 / 156
- Clubs with profiles: 490 (unique IDs: true)
- Sourced / estimated profiles: 30 / 460

## Positive controls
- Affordable small-club fit: eligible 244, offers 1 — OK
- Elite senior-ready: elite-senior eligible 17 — OK
- Qualified prospect: pathway 25, eligible 393 — OK

## Serie B fixture
- Reject 100m: true
- Reject 8m vs 3m max: true
- Valid 2m / 3500wk: true

## Offers by expected role
- starter: 636
- prospect: 252
- rotation: 190
- cover: 52

## Top rejection reasons
- fee-above-ordinary-deal-band: 900
- no-fee-overlap: 23
- insufficient-cash-reserve: 6
- exceeds-transfer-authorisation: 4
- buyerMax=3600000: 3
- buyerMax=4000000: 3
- sellerMin=5000000: 2
- sellerMin=5600000: 2
- sellerMin=6600000: 2
- buyerMax=3000000: 2
- mls-exceeds-max-budget-charge: 2
- sellerMin=4400000: 1
- buyerMax=2700000: 1
- sellerMin=6200000: 1
- buyerMax=3100000: 1

## Per-league eligible / offers / schedule
- league:england-premier-league: eligible 11360, offers 60, schedule fixtures 380
- league:england-championship: eligible 11364, offers 49, schedule fixtures 552
- league:germany-bundesliga: eligible 11398, offers 72, schedule fixtures 306
- league:germany-2-bundesliga: eligible 11369, offers 36, schedule fixtures 306
- league:spain-la-liga: eligible 11376, offers 69, schedule fixtures 380
- league:spain-laliga-2: eligible 11371, offers 36, schedule fixtures 462
- league:italy-serie-a: eligible 11339, offers 83, schedule fixtures 380
- league:italy-serie-b: eligible 11361, offers 36, schedule fixtures 380
- league:france-ligue-1: eligible 11400, offers 64, schedule fixtures 306
- league:france-ligue-2: eligible 11370, offers 36, schedule fixtures 306
- league:brazil-brasileirao-serie-a: eligible 11380, offers 42, schedule fixtures 380
- league:belgium-belgian-pro-league: eligible 11359, offers 36, schedule fixtures 240
- league:argentina-liga-profesional: eligible 11351, offers 36, schedule fixtures 870
- league:portugal-primeira-liga: eligible 11368, offers 40, schedule fixtures 306
- league:poland-ekstraklasa: eligible 11359, offers 36, schedule fixtures 306
- league:denmark-superliga: eligible 11353, offers 36, schedule fixtures 132
- league:norway-eliteserien: eligible 11346, offers 36, schedule fixtures 240
- league:mexico-liga-mx: eligible 11359, offers 37, schedule fixtures 306
- league:colombia-categoria-primera-a: eligible 11311, offers 36, schedule fixtures 380
- league:netherlands-eredivisie: eligible 11331, offers 39, schedule fixtures 306
- league:ecuador-ligapro-serie-a: eligible 11376, offers 36, schedule fixtures 240
- league:turkiye-super-lig: eligible 11366, offers 37, schedule fixtures 306
- league:united-states-mls: eligible 11352, offers 34, schedule fixtures 870
- league:czechia-czech-first-league: eligible 11329, offers 36, schedule fixtures 240
- league:croatia-hnl: eligible 11306, offers 36, schedule fixtures 90
- league:serbia-superliga: eligible 11378, offers 36, schedule fixtures 240

## Commands
```
node tests/transferLoanPipeline.test.mjs
node tests/transferLoanFollowup.test.mjs
node tests/crossLeagueCareer.test.mjs
node tests/browserFlowSmoke.test.mjs
node scripts/calibrateTransferLoan.mjs
```
