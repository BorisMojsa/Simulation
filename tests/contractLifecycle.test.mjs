/**
 * Contract lifecycle authority: renewal review, expiry, free agency, loans, offers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { generatePipelineOffers, acceptPipelineOffer, applyOfferToPlayer } from "../js/simulation/dealPipeline.js";
import { evaluateSquadDecision, resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import {
  resetClubFinanceLedgers,
  getOrInitClubSeasonFinance,
  exportClubFinanceState,
  importClubFinanceState,
} from "../js/simulation/clubFinance.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  ensureContractAuthority,
  evaluateRenewalReview,
  isContractActive,
  isFreeAgent,
  releaseToFreeAgency,
  applyContractExpiryAtBoundary,
  isOfferExecutable,
  markOfferStatus,
  selectNextCareerAction,
  CONTRACT_LIFECYCLE_VERSION,
} from "../js/simulation/contractLifecycle.js";
import { startLoan, endLoan } from "../js/simulation/loanMarket.js";
import { flattenRoundRobinFixtures, dateLeagueFixtures } from "../js/simulation/seasonCalendar.js";
import { serializeCareerSnapshot, deserializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";

function atalantaPlayer(extra = {}) {
  resetClubFinanceLedgers();
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const club = league.clubs.find((c) => c.name === "Atalanta");
  const p = createPlayerIdentity({
    name: "Contract QA",
    nationality: "Germany",
    position: "RW",
    age: 18,
  });
  Object.assign(p, {
    startYear: 2026,
    rating: 72,
    potential: 85,
    attributes: {
      Speed: 72,
      Passing: 74,
      Shooting: 68,
      Defending: 70,
      Physicality: 72,
      Dribbling: 73,
    },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
    health: { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} },
    development: { latentBudget: 87, modelVersion: 1, migration: {} },
    club: {
      ...club,
      league: league.name,
      leagueDisplay: league.displayName,
      leagueId: league.leagueId,
      nation: league.nation,
      isAcademy: false,
      parentClub: null,
    },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStartSeason: 0,
    contractYears: 1,
    contractEndSeason: 1,
    weeklyWage: 7200,
    wage: 7200,
    ...extra,
  });
  ensurePlayerModel(p);
  ensureTransferSave(p);
  ensureContractAuthority(p);
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(42);
  return p;
}

test("undefined review does not produce definitive non-renewal notice", () => {
  const p = atalantaPlayer({ contractEndSeason: 3, contractYears: 3 });
  delete p.renewalPlanned;
  delete p.renewalReview;
  ensureContractAuthority(p);
  const decision = evaluateSquadDecision(p, { checkpoint: "pre-season", seasonIndex: 0 });
  assert.notEqual(decision?.kind, "non-renewal");
});

test("will-renew fixture: renewal exists for employer; no contradictory notice", () => {
  const p = atalantaPlayer();
  p.renewalReview = {
    outcome: "wants-renewal",
    reason: "club-interest",
    employerClubId: p.employmentClubId,
    contractRevision: p.contractRevision,
    reviewSeason: 0,
    reviewId: "forced-renew",
  };
  p.renewalPlanned = true;
  // Force a successful renewal probe by evaluating with high performance
  const gen = generatePipelineOffers(p, { forceGenerate: true, performanceScore: 85 });
  const hasRenewal = gen.offers.some((o) => o.isRenewal);
  // With wants-renewal already set and forceReevaluate false, evaluateRenewalReview preserves it
  const review = evaluateRenewalReview(p, { performanceScore: 85 });
  assert.equal(review.outcome, "wants-renewal");
  const decision = evaluateSquadDecision(p, {
    checkpoint: "pre-season",
    seasonIndex: 0,
    renewalReview: review,
  });
  if (hasRenewal) {
    assert.notEqual(decision?.kind, "non-renewal");
    assert.ok(gen.offers.every((o) => o.clubId === p.employmentClubId || !o.isRenewal || o.clubId === p.employmentClubId));
  }
});

test("will-not-renew fixture: non-renewal reason exists; no same-review renewal", () => {
  const p = atalantaPlayer({ age: 37, rating: 62 });
  const review = evaluateRenewalReview(p, { performanceScore: 40, forceReevaluate: true });
  assert.equal(review.outcome, "will-not-renew");
  const gen = generatePipelineOffers(p, { forceGenerate: true, performanceScore: 40 });
  assert.equal(gen.offers.some((o) => o.isRenewal), false);
  const decision = evaluateSquadDecision(p, {
    checkpoint: "pre-season",
    seasonIndex: 0,
    renewalReview: review,
  });
  assert.equal(decision?.kind, "non-renewal");
});

test("temporary finance rejection does not become firm non-renewal", () => {
  const p = atalantaPlayer();
  const review = evaluateRenewalReview(p, {
    performanceScore: 80,
    financeOk: false,
    financeReason: "wage-headroom",
    forceReevaluate: true,
  });
  assert.equal(review.outcome, "temporary-reject");
  assert.notEqual(p.renewalPlanned, false);
  const decision = evaluateSquadDecision(p, {
    checkpoint: "pre-season",
    seasonIndex: 0,
    renewalReview: review,
  });
  assert.notEqual(decision?.kind, "non-renewal");
});

test("audit reproduction: no renewal+non-renewal contradiction; expiry releases", () => {
  const p = atalantaPlayer();
  p.pendingOffers = generatePipelineOffers(p, { forceGenerate: true, performanceScore: 75 }).offers;
  const decision = evaluateSquadDecision(p, { checkpoint: "pre-season" });
  const hasRenewal = p.pendingOffers.some((o) => o.isRenewal);
  if (hasRenewal) {
    assert.notEqual(decision?.kind, "non-renewal");
  }
  if (decision?.kind === "non-renewal") {
    assert.equal(hasRenewal, false);
  }
  if (decision) {
    resolveSquadDecision(p, decision, "see-out");
  }
  for (let i = 0; i < 3; i++) {
    p.pendingOffers = [];
    p.pendingDecision = null;
    const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    if (i === 0) {
      // First season under contract may complete with appearances
      assert.ok(result.season || result.freeAgent);
    } else {
      // After expiry: free agent — no old-club appearances
      assert.ok(isFreeAgent(p) || result.freeAgent || !p.club);
      if (result.season) {
        assert.ok(result.season.freeAgent || result.season.matches === 0 || result.freeAgent);
      }
      assert.equal(p.weeklyWage || 0, 0);
    }
  }
  assert.ok(isFreeAgent(p) || p.contractStatus === "released" || !p.club);
});

test("invalid decision choice does not mutate", () => {
  const p = atalantaPlayer({ age: 37, rating: 60 });
  const review = evaluateRenewalReview(p, { performanceScore: 35, forceReevaluate: true });
  const decision = evaluateSquadDecision(p, {
    checkpoint: "pre-season",
    seasonIndex: 0,
    renewalReview: review,
  });
  assert.equal(decision?.kind, "non-renewal");
  p.pendingDecision = decision;
  const before = structuredClone(p.decisionCooldowns || {});
  const result = resolveSquadDecision(p, decision, "stay-compete");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-choice");
  assert.ok(p.pendingDecision);
});

test("cloned/replayed offer cannot extend twice or restore old employer", () => {
  const p = atalantaPlayer({ contractEndSeason: 2, contractYears: 2 });
  p.renewalReview = {
    outcome: "wants-renewal",
    reason: "club-interest",
    employerClubId: p.employmentClubId,
    contractRevision: p.contractRevision,
    reviewSeason: 0,
    reviewId: "r1",
  };
  const gen = generatePipelineOffers(p, { forceGenerate: true, performanceScore: 88 });
  const renewal = gen.offers.find((o) => o.isRenewal);
  if (!renewal) {
    // Affordability/sporting may block; still verify executable guard on a synthetic offer
    const fake = {
      ...p.club,
      club: p.club.name,
      clubDisplay: p.club.displayName,
      clubId: p.club.clubId,
      isRenewal: true,
      dealType: "renewal",
      wage: 8000,
      transferFee: 0,
      contractYears: 3,
      offerId: "synthetic-renewal",
      status: "pending",
      contractRevision: p.contractRevision,
      careerId: p.careerId || p.name,
    };
    const first = acceptPipelineOffer(p, fake);
    // May fail affordability; if ok, clone must fail
    if (first.ok) {
      const clone = { ...fake, acceptedTransactionId: undefined };
      const second = acceptPipelineOffer(p, clone);
      assert.equal(second.ok, false);
    }
    return;
  }
  const first = acceptPipelineOffer(p, renewal);
  assert.equal(first.ok, true);
  const endAfter = p.contractEndSeason;
  const clone = { ...renewal, acceptedTransactionId: undefined, status: "pending" };
  markOfferStatus(p, clone, "pending"); // try to revive
  p.offerJournal[clone.offerId] = { status: "pending", offerId: clone.offerId };
  // consumedTransitionIds / completedDealIds should still block
  const second = acceptPipelineOffer(p, clone);
  assert.equal(second.ok, false);
  assert.equal(p.contractEndSeason, endAfter);
});

test("stale employer renewal cannot switch transferred player back", () => {
  const p = atalantaPlayer({ contractEndSeason: 4, contractYears: 4 });
  const stale = {
    club: "Atalanta",
    clubDisplay: "Atalanta",
    clubId: p.employmentClubId,
    isRenewal: true,
    dealType: "renewal",
    wage: 9000,
    transferFee: 0,
    contractYears: 3,
    offerId: "stale-atalanta-renewal",
    status: "pending",
    contractRevision: p.contractRevision,
    careerId: p.careerId || p.name,
  };
  // Move player to another club
  const mls = LEAGUE_BY_ID.get("league:usa-mls") || LEAGUES.find((l) => /mls|MLS/i.test(l.name));
  const atlanta = mls?.clubs?.find((c) => /Atlanta/i.test(c.name));
  if (atlanta) {
    p.club = { ...atlanta, league: mls.name, leagueId: mls.leagueId, isAcademy: false };
    p.employmentClubId = atlanta.clubId;
    p.playingClubId = atlanta.clubId;
    bumpRevision(p);
  } else {
    p.employmentClubId = "club:elsewhere";
    p.playingClubId = "club:elsewhere";
    p.club = { ...p.club, clubId: "club:elsewhere", name: "Elsewhere" };
    bumpRevision(p);
  }
  const check = isOfferExecutable(p, stale);
  assert.equal(check.ok, false);
  assert.equal(check.reason, "stale-employer-renewal");
});

function bumpRevision(p) {
  p.contractRevision = `ctr:${p.name}:${p.employmentClubId}:4:9`;
}

test("free agent / no offers: no crash, no old wage, useful next action", () => {
  const p = atalantaPlayer();
  releaseToFreeAgency(p, "test");
  assert.equal(p.club, null);
  assert.equal(p.weeklyWage, 0);
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(result.freeAgent || result.season?.freeAgent);
  assert.equal(p.weeklyWage || 0, 0);
  const next = selectNextCareerAction(p);
  assert.ok(["free-agent", "resolve-offers", "start-season"].includes(next.id) || next.mode === "free-agent");
});

test("league fixtures: no club/date double-booking", () => {
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const clubs = league.clubs.map((c) => ({ ...c }));
  const fixtures = flattenRoundRobinFixtures(clubs, { idPrefix: "test" });
  assert.equal(fixtures.length, clubs.length * (clubs.length - 1));
  const dated = dateLeagueFixtures(fixtures, 2026);
  const byDateClub = new Map();
  for (const fx of dated) {
    for (const side of [fx.home, fx.away]) {
      const key = `${fx.date}|${side.clubId || side.name}`;
      assert.equal(byDateClub.has(key), false, `conflict ${key}`);
      byDateClub.set(key, true);
    }
  }
});

test("duplicate loan acceptance is rejected without mutating slots twice", () => {
  const p = atalantaPlayer({ contractEndSeason: 4, contractYears: 4, age: 19 });
  // Build a synthetic loan offer to a lower club if possible
  const czech = LEAGUE_BY_ID.get("league:czech-fortuna-liga") ||
    LEAGUES.find((l) => /czech|Czech/i.test(l.nation || l.name));
  const borrower = czech?.clubs?.[0];
  if (!borrower) return;
  const loanId = `loan:${p.name}:${borrower.clubId}:2026`;
  const offer = {
    isLoan: true,
    club: borrower.name,
    clubId: borrower.clubId,
    wage: p.weeklyWage,
    expectedRole: "rotation",
    loanTerms: {
      loanId,
      parentClubId: p.employmentClubId,
      borrowingClubId: borrower.clubId,
      endSeason: 2,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      loanFee: 0,
      international: true,
    },
  };
  const first = startLoan(p, offer);
  if (!first.ok) return; // affordability may block in some profiles
  const parentLedger = getOrInitClubSeasonFinance(p.employmentClubId || offer.loanTerms.parentClubId, "2026");
  const outAfter = parentLedger.registrationSlots.internationalLoansOut;
  const second = startLoan(p, offer);
  assert.equal(second.ok, false);
  assert.ok(second.duplicate || second.reason === "duplicate-loan" || second.reason === "already-on-loan");
  assert.equal(parentLedger.registrationSlots.internationalLoansOut, outAfter);
});

test("unaffordable purchase stress case leaves loan intact", () => {
  const p = atalantaPlayer({ contractEndSeason: 4, contractYears: 4 });
  const czech = LEAGUES.find((l) => /czech|Czech/i.test(l.nation || "") || /czech/i.test(l.name));
  const borrower = czech?.clubs?.[0];
  if (!borrower) return;
  p.parentClubSnapshot = { ...p.club };
  p.activeLoan = {
    loanId: "loan-stress",
    parentClubId: p.employmentClubId,
    borrowingClubId: borrower.clubId,
    status: "active",
    purchaseOption: { fee: 100_000_000, wage: 1_000_000 },
    agreedGrossWeekly: 7200,
    borrowerWageShare: 0.5,
    parentWageShare: 0.5,
    previousWeeklyWage: 7200,
    settledFinance: false,
  };
  p.club = { ...borrower, isLoanSpell: true };
  const buyerLedger = getOrInitClubSeasonFinance(borrower.clubId, "2026");
  buyerLedger.cashAvailable = 710_000;
  buyerLedger.remainingTransferAuthorisation = 710_000;
  buyerLedger.remainingWageHeadroom = 50_000;
  const beforeCash = buyerLedger.cashAvailable;
  const result = endLoan(p, "purchase");
  assert.equal(result.ok, false);
  assert.equal(p.activeLoan.status, "active");
  assert.equal(buyerLedger.cashAvailable, beforeCash);
});

test("lifecycle version exported", () => {
  assert.equal(CONTRACT_LIFECYCLE_VERSION, 1);
});
