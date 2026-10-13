/**
 * Seeded transfer/loan calibration with positive controls and coverage.
 * Run: node scripts/calibrateTransferLoan.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { LEAGUES } from "../js/data/leagues.js";
import {
  financeCoverageReport,
  FINANCE_PROFILE_VERSION,
  getAllClubFinanceProfiles,
  SYNTHETIC_SERIE_B_FIXTURE,
} from "../js/data/clubFinanceProfiles.js";
import {
  resetClubFinanceLedgers,
  ledgerFromSyntheticSerieB,
  validateDealAffordability,
} from "../js/simulation/clubFinance.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { generateLoanOffers, startLoan, endLoan } from "../js/simulation/loanMarket.js";
import { findEligibleClubs } from "../js/simulation/recruitmentModel.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { CLUB_STRENGTH_BANDS, RECRUITMENT_CONFIG_VERSION } from "../js/config/recruitmentConfig.js";
import { FX_SNAPSHOT } from "../js/config/recruitmentConfig.js";
import { negotiateFee } from "../js/simulation/playerValuation.js";
import { REGISTRATION_RULE_VERSION } from "../js/data/registrationWindows.js";
import { buildDestinationLeagueSchedule } from "../js/simulation/destinationSchedule.js";

function gitIdentity() {
  try {
    const rev = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf8" });
    return { rev, dirty: status.trim().length > 0, statusLines: status.trim().split("\n").filter(Boolean).length };
  } catch {
    return { rev: "unknown", dirty: true, statusLines: -1 };
  }
}

function hashFile(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

function makePlayer({ age, rating, position, leagueId, careerId, contractYears = 2, potential }) {
  const clubs = allSeniorClubs().filter((c) => c.leagueId === leagueId);
  const club = clubs[Math.floor(clubs.length / 2)] || allSeniorClubs()[0];
  const pot = potential ?? rating + 6;
  return {
    name: careerId,
    careerId,
    nationality: club.nation || "England",
    position,
    age,
    rating,
    potential: pot,
    attributes: {
      Speed: rating,
      Passing: rating,
      Shooting: rating - 2,
      Defending: rating - 1,
      Physicality: rating,
      Dribbling: rating,
    },
    development: { latentBudget: pot, modelVersion: 1, migration: {} },
    club: { ...club, isAcademy: false, parentClub: null },
    seasons: [{ matches: 24, minutes: 1800, goals: 3, assists: 4 }],
    contractStartSeason: 0,
    contractYears,
    contractEndSeason: contractYears,
    weeklyWage: 2000,
    pendingOffers: [],
  };
}

function pct(arr, p) {
  if (!listable(arr)) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function listable(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

const started = Date.now();
const identity = gitIdentity();
resetClubFinanceLedgers();

const coverage = financeCoverageReport();
const profiles = [...getAllClubFinanceProfiles().values()];
const duplicateCheck = profiles.length === new Set(profiles.map((p) => p.clubId)).size;

const scenarios = [];
const ages = [18, 22, 28];
const ratings = [56, 64, 72, 80];
const positions = ["ST", "CM", "CB"];
const leagueSample = LEAGUES.map((l) => l.leagueId);

let eliteSenior = 0;
let eliteSeniorLowOvr = 0;
let eliteProspect = 0;
let offerCount = 0;
let eligibleTotal = 0;
let feeSamples = [];
let wageSamples = [];
let loanStarts = 0;
let loanReturns = 0;
const rejectionReasons = {};
const byLeagueOffers = {};
const byLeagueEligible = {};
const roleCounts = {};

let scenarioIdx = 0;
for (const leagueId of leagueSample) {
  byLeagueEligible[leagueId] = 0;
  for (const age of ages) {
    for (const rating of ratings) {
      for (const position of positions) {
        scenarioIdx += 1;
        const careerId = `cal-${scenarioIdx}`;
        const player = makePlayer({ age, rating, position, leagueId, careerId });
        const eligible = findEligibleClubs(player, allSeniorClubs(), {
          careerId,
          seasonIndex: 1,
          skipProspectProbability: true,
          preferLowerDivisions: rating < 68,
        });
        byLeagueEligible[leagueId] += eligible.length;
        eligibleTotal += eligible.length;
        const offers = generateTransferOffers(65, player, LEAGUES, null, 6.9);
        offerCount += offers.length;
        for (const o of offers) {
          byLeagueOffers[o.leagueId] = (byLeagueOffers[o.leagueId] || 0) + 1;
          roleCounts[o.expectedRole || "unknown"] = (roleCounts[o.expectedRole || "unknown"] || 0) + 1;
          if ((o.overall || 0) >= CLUB_STRENGTH_BANDS.eliteSeniorMinOverall) {
            if (o.pathway === "prospect" || o.expectedRole === "prospect") eliteProspect += 1;
            else {
              eliteSenior += 1;
              if (rating <= 60) eliteSeniorLowOvr += 1;
            }
          }
          if (o.transferFee > 0) feeSamples.push(o.transferFee);
          if (o.wage > 0) wageSamples.push(o.wage);
        }
        if (player.lastOfferRejectionLog) {
          for (const r of player.lastOfferRejectionLog) {
            for (const reason of r.reasons || []) {
              rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
            }
          }
        }
        if (age <= 21 && rating <= 66) {
          const loans = generateLoanOffers(player, {
            rng: createStreamRng(careerId, "loan-cal"),
            maxOffers: 2,
          });
          if (loans.offers[0]) {
            const st = startLoan(player, loans.offers[0]);
            if (st.ok) {
              loanStarts += 1;
              if (endLoan(player, "return").ok) loanReturns += 1;
            }
          }
        }
        scenarios.push({ careerId, age, rating, position, leagueId, offers: offers.length, eligible: eligible.length });
      }
    }
  }
}

// Positive controls
const positiveControls = {};
{
  // Affordable smaller-club fit
  const small = makePlayer({
    age: 24,
    rating: 62,
    position: "CM",
    leagueId: "league:serbia-superliga",
    careerId: "pos-small",
    potential: 68,
  });
  const eligSmall = findEligibleClubs(small, allSeniorClubs(), {
    careerId: "pos-small",
    skipProspectProbability: true,
  });
  const offersSmall = generateTransferOffers(70, small, LEAGUES, null, 7.0);
  positiveControls.affordableSmallClub = {
    eligible: eligSmall.length,
    offers: offersSmall.length,
    sampleDestinations: offersSmall.slice(0, 3).map((o) => ({ club: o.club, league: o.leagueId, role: o.expectedRole, wage: o.wage, fee: o.transferFee })),
    ok: eligSmall.length > 0,
  };

  // Elite senior-ready
  const elite = makePlayer({
    age: 26,
    rating: 86,
    position: "ST",
    leagueId: "league:england-premier-league",
    careerId: "pos-elite",
    potential: 90,
  });
  const eligElite = findEligibleClubs(elite, allSeniorClubs(), {
    careerId: "pos-elite",
    skipProspectProbability: true,
  });
  const eliteSeniorElig = eligElite.filter((c) => c.fit.elite && c.fit.pathway === "senior");
  positiveControls.eliteSeniorReady = {
    eligible: eligElite.length,
    eliteSeniorEligible: eliteSeniorElig.length,
    ok: eliteSeniorElig.length > 0,
  };

  // Qualified prospect
  const prospect = makePlayer({
    age: 18,
    rating: 68,
    position: "CAM",
    leagueId: "league:croatia-hnl",
    careerId: "pos-prospect",
    potential: 88,
  });
  prospect.development.latentBudget = 88;
  const eligP = findEligibleClubs(prospect, allSeniorClubs(), {
    careerId: "pos-prospect",
    skipProspectProbability: true,
  });
  const prospectPath = eligP.filter((c) => c.fit.pathway === "prospect");
  positiveControls.qualifiedProspect = {
    eligible: eligP.length,
    prospectPathway: prospectPath.length,
    ok: prospectPath.length > 0 || eligP.length > 0,
  };
}

// Serie B hard fixture
const serieBLedger = ledgerFromSyntheticSerieB(SYNTHETIC_SERIE_B_FIXTURE);
const serieBChecks = {
  reject100m: !validateDealAffordability(serieBLedger, {
    transferFee: 100_000_000,
    wage: 3500,
    contractYears: 4,
    expectedRole: "starter",
  }).ok,
  reject8mVs3m: !negotiateFee(
    { min: 8_000_000, ask: 8_000_000, freeAgent: false },
    { max: 3_000_000, target: 3_000_000 }
  ).overlap,
  valid2m: validateDealAffordability(serieBLedger, {
    transferFee: 2_000_000,
    wage: 3500,
    contractYears: 4,
    expectedRole: "rotation",
  }).ok,
};

// Destination schedule coverage for every league
const scheduleCoverage = {};
for (const league of LEAGUES) {
  const sched = buildDestinationLeagueSchedule(league, 2026);
  scheduleCoverage[league.leagueId] = { fixtures: sched.dated.length, clubs: sched.clubs.length };
}

const leaguesWithZeroEligible = leagueSample.filter((id) => byLeagueEligible[id] === 0);
const runtimeMs = Date.now() - started;

const report = {
  generatedAt: new Date().toISOString(),
  revision: identity,
  versions: {
    financeProfile: FINANCE_PROFILE_VERSION,
    recruitment: RECRUITMENT_CONFIG_VERSION,
    fx: FX_SNAPSHOT.version,
    registration: REGISTRATION_RULE_VERSION,
  },
  hashes: {
    clubFinanceProfiles: hashFile("js/data/clubFinanceProfiles.js"),
    recruitmentConfig: hashFile("js/config/recruitmentConfig.js"),
    dealPipeline: hashFile("js/simulation/dealPipeline.js"),
    destinationSchedule: hashFile("js/simulation/destinationSchedule.js"),
    registrationWindows: hashFile("js/data/registrationWindows.js"),
  },
  coverage: {
    ...coverage,
    uniqueClubIds: duplicateCheck,
    estimatedFieldsNote:
      "Most board authorisations and wage bands are declared simulation allocations with estimatedFields — not verified private budgets.",
  },
  sampleSize: scenarios.length,
  runtimeMs,
  summary: {
    offerCount,
    meanOffersPerScenario: offerCount / scenarios.length,
    eligibleTotal,
    meanEligiblePerScenario: eligibleTotal / scenarios.length,
    eliteSeniorOffers: eliteSenior,
    eliteSeniorOffersLowOvr: eliteSeniorLowOvr,
    eliteProspectOffers: eliteProspect,
    feeP50: pct(feeSamples, 50),
    feeP90: pct(feeSamples, 90),
    wageP50: pct(wageSamples, 50),
    wageP90: pct(wageSamples, 90),
    loanStarts,
    loanReturns,
    roleCounts,
    zeroEliteSeniorLowOvrRequired: eliteSeniorLowOvr === 0,
    leaguesWithZeroEligibleAcrossScenarios: leaguesWithZeroEligible,
  },
  positiveControls,
  serieBChecks,
  rejectionReasons,
  offersByLeague: byLeagueOffers,
  eligibleByLeague: byLeagueEligible,
  scheduleCoverage,
  notes: [
    "Squad-review checkpoints are not universal registration windows; see REGISTRATION_RULE_VERSION.",
    "Cross-league mid-season moves attach destination remaining fixtures via destinationSchedule.js.",
    "National-team strength is not used in club recruiting or budgets.",
  ],
};

writeFileSync("reports/transfer-loan-calibration.json", JSON.stringify(report, null, 2));
const topRejections = Object.entries(rejectionReasons)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
const roleLines = Object.entries(roleCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n");
const leagueOfferLines = leagueSample
  .map(
    (id) =>
      `- ${id}: eligible ${byLeagueEligible[id] || 0}, offers ${byLeagueOffers[id] || 0}, schedule fixtures ${scheduleCoverage[id]?.fixtures ?? 0}`
  )
  .join("\n");

writeFileSync(
  "reports/transfer-loan-data-coverage.json",
  JSON.stringify(
    {
      generatedAt: report.generatedAt,
      revision: identity,
      ...coverage,
      uniqueClubIds: duplicateCheck && coverage.uniqueClubIds !== false,
      estimatedCount: coverage.estimatedCount,
      sourcedCount: coverage.sourcedCount,
      scheduleCoverage,
      note: coverage.honesty || report.coverage.estimatedFieldsNote,
    },
    null,
    2
  )
);

const md = `# Transfer / loan calibration

- Revision: \`${identity.rev}\`${identity.dirty ? " (dirty working tree)" : ""}
- Scenarios: ${scenarios.length}
- Runtime: ${runtimeMs} ms
- Offers: ${offerCount} (mean ${(offerCount / scenarios.length).toFixed(2)} / scenario)
- Eligible candidates (sum): ${eligibleTotal}
- Elite SENIOR offers (all ratings): ${eliteSenior}
- Elite SENIOR offers for ≤60 OVR fixtures: **${eliteSeniorLowOvr}** (must be 0)
- Elite prospect pathway offers: ${eliteProspect}
- Fee P50/P90: ${report.summary.feeP50} / ${report.summary.feeP90}
- Wage P50/P90 weekly GBP: ${report.summary.wageP50} / ${report.summary.wageP90}
- Loan start/return: ${loanStarts} / ${loanReturns}
- Clubs with profiles: ${coverage.clubCount} (unique IDs: ${duplicateCheck})
- Sourced / estimated profiles: ${coverage.sourcedCount} / ${coverage.estimatedCount}

## Positive controls
- Affordable small-club fit: eligible ${positiveControls.affordableSmallClub.eligible}, offers ${positiveControls.affordableSmallClub.offers} — ${positiveControls.affordableSmallClub.ok ? "OK" : "FAIL"}
- Elite senior-ready: elite-senior eligible ${positiveControls.eliteSeniorReady.eliteSeniorEligible} — ${positiveControls.eliteSeniorReady.ok ? "OK" : "FAIL"}
- Qualified prospect: pathway ${positiveControls.qualifiedProspect.prospectPathway}, eligible ${positiveControls.qualifiedProspect.eligible} — ${positiveControls.qualifiedProspect.ok ? "OK" : "FAIL"}

## Serie B fixture
- Reject 100m: ${serieBChecks.reject100m}
- Reject 8m vs 3m max: ${serieBChecks.reject8mVs3m}
- Valid 2m / 3500wk: ${serieBChecks.valid2m}

## Offers by expected role
${roleLines || "- (none)"}

## Top rejection reasons
${topRejections.map(([r, n]) => `- ${r}: ${n}`).join("\n") || "- (none logged)"}

## Per-league eligible / offers / schedule
${leagueOfferLines}

## Commands
\`\`\`
node tests/transferLoanPipeline.test.mjs
node tests/transferLoanFollowup.test.mjs
node tests/crossLeagueCareer.test.mjs
node tests/browserFlowSmoke.test.mjs
node scripts/calibrateTransferLoan.mjs
\`\`\`
`;
writeFileSync("reports/transfer-loan-calibration.md", md);
writeFileSync(
  "reports/transfer-loan-data-coverage.md",
  `# Finance data coverage

Clubs: ${coverage.clubCount}. Leagues: ${coverage.leagueCount}.
Unique club IDs: ${duplicateCheck && coverage.uniqueClubIds !== false}.
Duplicate IDs: ${(coverage.duplicateIds || []).length ? coverage.duplicateIds.join(", ") : "none"}.
Unmatched profile IDs: ${(coverage.unmatchedProfileIds || []).length ? coverage.unmatchedProfileIds.join(", ") : "none"}.
Sourced profiles: ${coverage.sourcedCount}.
Estimated profiles: ${coverage.estimatedCount}.
Leagues missing baseline: ${(coverage.leaguesMissingBaseline || []).length ? coverage.leaguesMissingBaseline.join(", ") : "none"}.
Elite fallback on missing data: ${coverage.eliteFallbackOnMissing === false ? "no (conservative non-elite only)" : "YES — investigate"}.
Profile version: ${FINANCE_PROFILE_VERSION}.
Registration rules: ${REGISTRATION_RULE_VERSION}.

Every league has a baseline: ${Object.values(coverage.byLeague).every((r) => r.hasBaseline)}.
Schedule fixtures generated for every league: ${Object.values(scheduleCoverage).every((s) => s.fixtures > 0)}.

${coverage.honesty || report.coverage.estimatedFieldsNote}
`
);

console.log(md);
if (eliteSeniorLowOvr !== 0) process.exitCode = 1;
if (!positiveControls.affordableSmallClub.ok || !positiveControls.eliteSeniorReady.ok) process.exitCode = 1;
if (!serieBChecks.reject100m || !serieBChecks.reject8mVs3m) process.exitCode = 1;
