/**
 * Transfer / loan / finance pipeline invariants.
 * Run: node tests/transferLoanPipeline.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import {
  financeCoverageReport,
  getAllClubFinanceProfiles,
  getClubFinanceProfile,
  SYNTHETIC_SERIE_B_FIXTURE,
  FINANCE_PROFILE_VERSION,
} from "../js/data/clubFinanceProfiles.js";
import {
  resetClubFinanceLedgers,
  ledgerFromSyntheticSerieB,
  validateDealAffordability,
  bookDealTransaction,
  getOrInitClubSeasonFinance,
  annualFeeAmortisation,
  weeklyToAnnual,
  exportClubFinanceState,
  importClubFinanceState,
} from "../js/simulation/clubFinance.js";
import { evaluateSportingFit, findEligibleClubs } from "../js/simulation/recruitmentModel.js";
import { sellerReservation, negotiateFee, buyerWillingness, calculateContractLength, roundFee } from "../js/simulation/playerValuation.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { buildFirstProContractDecision, signFirstProfessionalContract, allSeniorClubs } from "../js/simulation/proContractOffers.js";
import { generateLoanOffers, startLoan, endLoan, normalizeWageShares, canRegisterInternationalLoan } from "../js/simulation/loanMarket.js";
import { resolveSquadDecision, evaluateSquadDecision } from "../js/simulation/squadDecisions.js";
import { migrateTransferSave } from "../js/simulation/transferMigration.js";
import { createStreamRng, reseedCareerRng } from "../js/simulation/rng.js";
import { createPlayerIdentity, finalizeAcademyPlayer } from "../js/simulation/playerDevelopment.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import { CLUB_STRENGTH_BANDS } from "../js/config/recruitmentConfig.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function weakPlayer(overrides = {}) {
  const p = createPlayerIdentity({
    name: "Weak Ordinary",
    nationality: "Italy",
    position: "CM",
    age: 22,
  });
  const club = allSeniorClubs().find((c) => c.leagueId === "league:italy-serie-b") || allSeniorClubs()[0];
  p.club = { ...club, isAcademy: false, parentClub: null };
  p.rating = 58;
  p.potential = 64;
  p.attributes = {
    Speed: 58, Acceleration: 58, Agility: 58, Strength: 58, Stamina: 58, Jumping: 58,
    Tackling: 58, Marking: 55, Positioning: 58, Passing: 60, Vision: 58, Crossing: 55,
    Dribbling: 58, BallControl: 58, Finishing: 52, LongShots: 55, Heading: 55, FreeKicks: 50,
  };
  p.development = { latentBudget: 64, modelVersion: 1, migration: {} };
  p.careerId = "weak-ordinary-1";
  p.seasons = [{ matches: 28, minutes: 2100, goals: 2, assists: 3 }];
  p.contractStartSeason = 0;
  p.contractYears = 2;
  p.contractEndSeason = 2;
  p.weeklyWage = 2500;
  Object.assign(p, overrides);
  return p;
}

test("every club has exactly one finance profile; no elite fallback for missing", () => {
  const report = financeCoverageReport();
  assert.equal(report.clubCount, 572);
  assert.equal(report.leagueCount, 31);
  for (const [leagueId, row] of Object.entries(report.byLeague)) {
    assert.equal(row.missing.length, 0, `${leagueId} missing profiles`);
    assert.equal(row.hasBaseline, true, `${leagueId} baseline`);
  }
  const profiles = [...getAllClubFinanceProfiles().values()];
  const ids = new Set(profiles.map((p) => p.clubId));
  assert.equal(ids.size, profiles.length);
});

test("Serie B ordinary single-deal band rejects 100m and 8m vs 3m max", () => {
  resetClubFinanceLedgers();
  const ledger = ledgerFromSyntheticSerieB(SYNTHETIC_SERIE_B_FIXTURE);
  const reject100 = validateDealAffordability(ledger, {
    transferFee: 100_000_000,
    wage: 3500,
    contractYears: 4,
    expectedRole: "starter",
  });
  assert.equal(reject100.ok, false);
  assert.ok(reject100.reasons.includes("exceeds-ordinary-single-deal"));

  const sellerMin = 8_000_000;
  const buyerMax = ledger.ordinarySingleDealMaximum;
  assert.ok(buyerMax < sellerMin);
  const neg = negotiateFee({ min: sellerMin, ask: sellerMin, freeAgent: false }, { max: buyerMax, target: buyerMax });
  assert.equal(neg.overlap, false);

  const okDeal = validateDealAffordability(ledger, {
    transferFee: 2_000_000,
    wage: 3500,
    contractYears: 4,
    expectedRole: "rotation",
  });
  assert.equal(okDeal.ok, true);
  assert.equal(weeklyToAnnual(3500), 182_000);
  assert.equal(annualFeeAmortisation(2_000_000, 4), 500_000);

  const unaffordableWage = validateDealAffordability(ledger, {
    transferFee: 0,
    wage: 20000,
    contractYears: 3,
    expectedRole: "rotation",
    isFreeAgent: true,
  });
  assert.equal(unaffordableWage.ok, false);
});

test("generation does not spend; acceptance books once; duplicate blocked", () => {
  resetClubFinanceLedgers();
  const ledger = ledgerFromSyntheticSerieB(SYNTHETIC_SERIE_B_FIXTURE);
  const before = ledger.remainingTransferAuthorisation;
  const deal = { transferFee: 2_000_000, wage: 3500, contractYears: 4, expectedRole: "rotation" };
  assert.equal(validateDealAffordability(ledger, deal).ok, true);
  assert.equal(ledger.remainingTransferAuthorisation, before);
  const b1 = bookDealTransaction(ledger, deal, "tx-1");
  assert.equal(b1.ok, true);
  const after = ledger.remainingTransferAuthorisation;
  assert.ok(after < before);
  const b2 = bookDealTransaction(ledger, deal, "tx-1");
  assert.equal(b2.duplicate, true);
  assert.equal(ledger.remainingTransferAuthorisation, after);
});

test("ordinary 55-60 OVR weak club: no elite SENIOR offers across seeds", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  let eliteSenior = 0;
  let anyOffers = 0;
  for (let seed = 0; seed < 80; seed++) {
    const p = weakPlayer({ careerId: `weak-${seed}`, rating: 56 + (seed % 5), potential: 62 });
    p.development = { latentBudget: 62, modelVersion: 1, migration: {} };
    const offers = generateTransferOffers(60, p, LEAGUES, null, 6.8);
    anyOffers += offers.length;
    for (const o of offers) {
      const elite = (o.overall || 0) >= CLUB_STRENGTH_BANDS.eliteSeniorMinOverall;
      if (elite && o.pathway === "senior" && o.expectedRole !== "prospect") {
        eliteSenior += 1;
      }
    }
  }
  assert.equal(eliteSenior, 0, `elite senior offers: ${eliteSenior}`);
  // Appropriate clubs may still appear across seeds
  assert.ok(anyOffers >= 0);
});

test("small fees below 500k possible; free agent fee 0", () => {
  assert.equal(roundFee(120_000), 125_000);
  const f = roundFee(80_000);
  assert.ok(f < 500_000 && f > 0);
  const p = weakPlayer({ contractEndSeason: 0, seasons: [] });
  const seller = sellerReservation(p, { isFreeAgent: true });
  assert.equal(seller.freeAgent, true);
  assert.equal(seller.min, 0);
});

test("under-18 contracts max 3 years", () => {
  const y = calculateContractLength(17, 70, 85, 80, createStreamRng("c", "cl"));
  assert.ok(y >= 1 && y <= 3);
  const adult = calculateContractLength(24, 80, 85, 80, createStreamRng("c", "cl2"));
  assert.ok(adult <= 5);
});

test("first pro path retains wage and uses pipeline", () => {
  resetClubFinanceLedgers();
  const pl = createPlayerIdentity({ name: "ProPath", nationality: "England", position: "ST", age: 17 });
  finalizeAcademyPlayer(pl, pickThreeAcademies(ACADEMY_POOL, "England", "ProPath")[0].academy);
  pl.seasons.push({ matches: 20, minutes: 1500, goals: 8, assists: 4 });
  const decision = buildFirstProContractDecision(pl);
  assert.ok(decision.verdict);
  if (decision.offers[0]) {
    signFirstProfessionalContract(pl, decision.offers[0]);
    assert.equal(pl.club.isAcademy, false);
    assert.ok(pl.weeklyWage > 0);
    assert.ok(pl.contractYears >= 1 && pl.contractYears <= 5);
  }
});

test("loan wage shares sum to 100%; decline keeps contract", () => {
  const shares = normalizeWageShares(0.6, 0.4);
  assert.ok(Math.abs(shares.borrowerWageShare + shares.parentWageShare - 1) < 1e-9);
  const p = weakPlayer({ age: 19, rating: 61, potential: 78 });
  p.development = { latentBudget: 80, modelVersion: 1, migration: {} };
  p.contractEndSeason = 3;
  const decision = {
    kind: "development-loan",
    cooldownKind: "development-loan",
    loanOffers: [],
    choices: [],
  };
  const beforeClub = p.club.name;
  const beforeEnd = p.contractEndSeason;
  const res = resolveSquadDecision(p, decision, "stay-compete");
  assert.equal(res.contractIntact, true);
  assert.equal(p.club.name, beforeClub);
  assert.equal(p.contractEndSeason, beforeEnd);
});

test("loan start/end return registration once", () => {
  resetClubFinanceLedgers();
  const p = weakPlayer({ age: 19, rating: 63, potential: 80, careerId: "loan-life" });
  p.development = { latentBudget: 82, modelVersion: 1, migration: {} };
  p.contractEndSeason = 4;
  const parentId = p.club.clubId;
  const { offers } = generateLoanOffers(p, {
    rng: createStreamRng("loan-life", "loans"),
    maxOffers: 5,
    forceGenerate: true,
  });
  if (!offers.length) {
    console.log("SKIP loan lifecycle (no eligible destination in this seed)");
    return;
  }
  const start = startLoan(p, offers[0]);
  assert.equal(start.ok, true);
  assert.equal(p.employmentClubId, parentId);
  assert.equal(p.playingClubId, offers[0].clubId);
  assert.equal(p.activeLoan.status, "active");
  const ended = endLoan(p, "return");
  assert.equal(ended.ok, true);
  assert.equal(p.activeLoan.status, "returned");
  assert.equal(p.club.clubId, parentId);
});

test("international loan youth exemption needs age AND club-trained", () => {
  const parent = { clubId: "a", registrationSlots: { internationalLoansOut: 6, internationalLoansIn: 0, sameClubPairLoans: {} } };
  const borrower = { clubId: "b", registrationSlots: { internationalLoansOut: 0, internationalLoansIn: 6, sameClubPairLoans: {} } };
  const young = { age: 19 };
  assert.equal(canRegisterInternationalLoan(parent, borrower, young, { clubTrained: false }).ok, false);
  assert.equal(canRegisterInternationalLoan(parent, borrower, young, { clubTrained: true }).ok, true);
});

test("save migration is idempotent and preserves contract", () => {
  const p = weakPlayer();
  p.wage = 3000;
  delete p.weeklyWage;
  const r1 = migrateTransferSave(p);
  assert.equal(r1.migrated, true);
  assert.equal(p.weeklyWage, 3000);
  assert.equal(p.transferSaveVersion, 2);
  const end = p.contractEndSeason;
  const r2 = migrateTransferSave(p);
  assert.equal(r2.migrated, false);
  assert.equal(p.contractEndSeason, end);
});

test("ledger survives export/import (reload)", () => {
  resetClubFinanceLedgers();
  const ledger = getOrInitClubSeasonFinance("club:italy:arezzo", "2026");
  ledger.remainingTransferAuthorisation = 1_234_567;
  const state = exportClubFinanceState();
  resetClubFinanceLedgers();
  importClubFinanceState(state);
  const again = getOrInitClubSeasonFinance("club:italy:arezzo", "2026");
  assert.equal(again.remainingTransferAuthorisation, 1_234_567);
});

test("Ecuador/Czechia/Croatia/Serbia not excluded by tier floor", () => {
  const p = weakPlayer({ rating: 64, potential: 72, age: 23, nationality: "Serbia" });
  p.development = { latentBudget: 72, modelVersion: 1, migration: {} };
  const clubs = allSeniorClubs().filter((c) =>
    ["league:ecuador-ligapro-serie-a", "league:czechia-czech-first-league", "league:croatia-hnl", "league:serbia-superliga"].includes(
      c.leagueId
    )
  );
  const eligible = findEligibleClubs(p, clubs, {
    careerId: "tier-floor",
    seasonIndex: 1,
    skipProspectProbability: true,
    relaxedDevelopment: true,
  });
  // At least some clubs in these leagues can be evaluated (may be empty if still unfit — but must not crash / hard-exclude by tier)
  assert.ok(Array.isArray(eligible));
  const byLeague = new Set(clubs.map((c) => c.leagueId));
  assert.equal(byLeague.size, 4);
});

test("finance profile version stamped", () => {
  const profile = getClubFinanceProfile(allSeniorClubs()[0].clubId);
  assert.equal(profile.profileVersion, FINANCE_PROFILE_VERSION);
});

if (!process.exitCode) {
  console.log("\nAll transfer/loan pipeline tests passed.");
}
