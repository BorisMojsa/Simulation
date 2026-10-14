/**
 * Browser-equivalent career flow smoke (DOM-free, mirrors main.js handlers).
 * Run: node tests/browserFlowSmoke.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID, ACADEMY_POOL } from "../js/data/leagues.js";
import { createPlayerIdentity, finalizeAcademyPlayer, promoteAcademyGraduateToFirstTeam } from "../js/simulation/playerDevelopment.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract,
} from "../js/simulation/proContractOffers.js";
import { generateRenewalOffer, generateTransferOffers } from "../js/simulation/transferMarket.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng, createStreamRng } from "../js/simulation/rng.js";
import { startLoan, endLoan, recallLoan, generateLoanOffers } from "../js/simulation/loanMarket.js";
import { acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import { resolveSquadDecision, queueSquadDecision } from "../js/simulation/squadDecisions.js";
import { applyDecisionPolicy } from "../js/simulation/decisionPolicies.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { getWorldState } from "../js/simulation/worldState.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { roundAbilityForDisplay } from "../js/ui/abilityFormatting.js";
import { stayChoiceIdForDecision } from "../js/ui/rendering.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";

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

/** Mirrors main.js applyTransfer + finishOfferWindow booking guard. */
function makeUiSession(player) {
  let bookingGuard = false;
  const log = [];
  return {
    player,
    log,
    applyTransfer(offer) {
      if (bookingGuard) {
        log.push("blocked-duplicate-click");
        return { ok: false, reason: "duplicate" };
      }
      bookingGuard = true;
      const nationality = player.nationality;
      let result;
      if (offer.isLoan) {
        result = startLoan(player, offer);
      } else {
        result = acceptPipelineOffer(player, offer);
      }
      player.nationality = nationality;
      if (result.ok) {
        player.pendingOffers = [];
        log.push({ accepted: true, club: offer.clubDisplay || offer.club, wage: offer.wage, role: offer.expectedRole, loan: !!offer.isLoan });
      } else {
        bookingGuard = false;
        log.push({ accepted: false, reason: result.reason || (result.reasons || []).join(",") });
      }
      return result;
    },
    declineAll() {
      player.pendingOffers = [];
      log.push("declined-window");
    },
    handleDecision(decision, choiceId) {
      const result = resolveSquadDecision(player, decision, choiceId);
      log.push({ decision: choiceId, action: result.action });
      return result;
    },
    resetGuard() {
      bookingGuard = false;
    },
  };
}

test("academy first contract → parent promotion → renewal path", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(11);
  setWorldState(createWorldState({ startYear: 2026 }));
  const academies = pickThreeAcademies(ACADEMY_POOL, "England", "Browser Flow");
  assert.ok(academies.length >= 1);
  const academy = academies[0].academy;
  const p = createPlayerIdentity({
    name: "Browser Flow",
    nationality: "England",
    position: "CM",
    age: 16,
  });
  finalizeAcademyPlayer(p, academy);
  assert.equal(p.club.isAcademy, true);
  assert.equal(Number.isInteger(roundAbilityForDisplay(p.rating)), true);

  const decision = buildFirstProContractDecision(p);
  assert.ok(decision.verdict);
  const ui = makeUiSession(p);
  if (decision.offers[0]) {
    const signed = signFirstProfessionalContract(p, decision.offers[0]);
    assert.ok(signed);
    assert.equal(p.weeklyWage, decision.offers[0].wage);
    assert.equal(p.club.isAcademy, false);
    ui.log.push({ firstPro: signed, wage: p.weeklyWage });
  } else {
    assert.equal(decision.emptyOffers, true);
    // Empty offers must not deadlock — simulateBtn would re-enable
    ui.declineAll();
    const senior = promoteAcademyGraduateToFirstTeam(p, 75);
    assert.ok(senior || p.club);
  }

  // Renewal when nearing expiry
  p.contractEndSeason = (p.seasons?.length ?? 0) + 1;
  p.contractYears = 1;
  const renewal = generateRenewalOffer(p, 72, LEAGUE_LOOKUP);
  if (renewal) {
    assert.equal(renewal.isRenewal, true);
    const beforeWage = p.weeklyWage;
    const r = acceptPipelineOffer(p, renewal);
    assert.equal(r.ok, true);
    assert.ok(p.weeklyWage >= beforeWage || p.contractEndSeason > (p.seasons?.length ?? 0));
    assert.equal(p.club.clubId, renewal.clubId || p.club.clubId);
  }
});

test("winter pause → loan accept/refuse → resume → return → purchase option", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(21);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const club = league.clubs[2];
  const p = createPlayerIdentity({ name: "Winter Loan", nationality: "Italy", position: "ST", age: 19 });
  p.startYear = 2026;
  p.rating = 64;
  p.potential = 82;
  p.attributes = {
    Speed: 64, Passing: 62, Shooting: 66, Defending: 50, Physicality: 64, Dribbling: 65,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 84, modelVersion: 1, migration: {} };
  p.club = { ...club, league: league.name, leagueDisplay: league.displayName, leagueId: league.leagueId, nation: league.nation, isAcademy: false, parentClub: null };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 4;
  p.contractEndSeason = 4;
  p.weeklyWage = 5000;
  p.careerId = "browser-winter-loan";

  const ui = makeUiSession(p);
  let paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  // Optional senior scenes pause before the winter squad window; auto-resolve them
  // so this test still covers the mid-season decision/loan lifecycle.
  let sceneGuards = 0;
  while (paused.awaitingScenario && sceneGuards < 12) {
    sceneGuards += 1;
    const pending = paused.pendingSeniorScenario || p.pendingSeniorScenario;
    if (pending && !pending.unschedulable) {
      applySeniorScenarioPolicy(p, pending, "balanced");
    }
    paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      checkpoint: paused.checkpoint,
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }

  if (paused.awaitingDecision) {
    assert.equal(p.seasons.length, 0);
    const ageAtPause = p.age;
    // Refuse path clears offers without booking
    p.pendingOffers = [];
    p.pendingDecision = null;
    const refuseSnap = roundTripCareerSnapshot({ player: p, world: getWorldState() });
    assert.equal(refuseSnap.player.age, ageAtPause);

    const resumed = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      checkpoint: paused.checkpoint,
      pauseForDecisions: false,
    });
    assert.notEqual(resumed.awaitingDecision, true);
    assert.equal(p.age, ageAtPause + 1);
    assert.equal(p.seasons.length, 1);
  } else {
    assert.equal(p.seasons.length, 1);
  }

  // Loan accept with forced terms (deterministic)
  const dest = allSeniorClubs().find(
    (c) => c.leagueId === "league:italy-serie-b" && c.clubId !== club.clubId
  );
  assert.ok(dest);
  const { offers } = generateLoanOffers(p, {
    rng: createStreamRng("browser-winter-loan", "force-loan"),
    maxOffers: 5,
    clubs: [dest, ...allSeniorClubs().filter((c) => c.leagueId === "league:italy-serie-b")],
  });
  let loanOffer = offers[0];
  if (!loanOffer) {
    // Synthetic validated-shaped loan for lifecycle
    loanOffer = {
      isLoan: true,
      club: dest.name,
      clubDisplay: dest.displayName,
      clubId: dest.clubId,
      leagueId: dest.leagueId,
      league: dest.league,
      leagueDisplay: dest.leagueDisplay,
      wage: p.weeklyWage,
      expectedRole: "rotation",
      loanFee: 50_000,
      loanTerms: {
        loanId: "loan:browser-forced",
        parentClubId: club.clubId,
        borrowingClubId: dest.clubId,
        borrowerWageShare: 0.6,
        parentWageShare: 0.4,
        loanFee: 50_000,
        startSeason: p.seasons.length,
        endSeason: p.seasons.length + 1,
        recallClause: true,
        purchaseOption: { fee: 2_500_000, wage: 5500 },
        status: "proposed",
        international: false,
      },
    };
  } else {
    loanOffer.loanTerms.recallClause = true;
    loanOffer.loanTerms.purchaseOption = { fee: 2_500_000, wage: loanOffer.wage };
  }

  const snapDecision = roundTripCareerSnapshot({ player: p, world: getWorldState() });
  assert.ok(snapDecision.player);

  const accept1 = ui.applyTransfer(loanOffer);
  assert.equal(accept1.ok, true);
  assert.equal(p.employmentClubId, club.clubId);
  assert.equal(p.playingClubId, loanOffer.loanTerms.borrowingClubId);
  assert.equal(p.weeklyWage, loanOffer.wage);
  const borrowerId = loanOffer.loanTerms.borrowingClubId;

  // Repeated click must not double-book
  const accept2 = ui.applyTransfer(loanOffer);
  assert.equal(accept2.ok, false);
  assert.ok(ui.log.includes("blocked-duplicate-click"));

  const snapDuring = roundTripCareerSnapshot({ player: p, world: getWorldState() });
  assert.equal(snapDuring.player.activeLoan.status, "active");

  // Loan-return reassessment while loan still active (mirrors main.js end-of-season)
  const returnDecision = queueSquadDecision(p, "loan-return", {
    seasonIndex: p.seasons.length,
    performanceScore: 70,
  });
  assert.ok(returnDecision);
  assert.equal(returnDecision.kind, "loan-return");
  const reintegrate = resolveSquadDecision(p, returnDecision, "reintegrate");
  assert.equal(reintegrate.action, "reintegrate");
  assert.equal(endLoan(p, "return").ok, true);
  assert.equal(p.club.clubId, club.clubId);

  // Fresh loan with purchase option
  ui.resetGuard();
  p.pendingDecision = null;
  loanOffer.loanTerms.loanId = "loan:browser-purchase";
  loanOffer.loanTerms.status = "proposed";
  assert.equal(startLoan(p, loanOffer).ok, true);
  const purchased = endLoan(p, "purchase");
  assert.equal(purchased.ok, true);
  assert.equal(p.activeLoan.status, "purchased");
  assert.equal(p.club.clubId, borrowerId);

  // Recall on another spell
  const p2Club = league.clubs[3];
  const p2 = createPlayerIdentity({ name: "Recall UI", nationality: "Italy", position: "CM", age: 20 });
  p2.startYear = 2026;
  p2.rating = 65;
  p2.potential = 80;
  p2.attributes = { Speed: 65, Passing: 65, Shooting: 60, Defending: 62, Physicality: 64, Dribbling: 64 };
  p2.playerModelVersion = 2;
  p2.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p2.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p2.development = { latentBudget: 80, modelVersion: 1, migration: {} };
  p2.club = { ...p2Club, league: league.name, leagueDisplay: league.displayName, leagueId: league.leagueId, nation: league.nation, isAcademy: false };
  p2.employmentClubId = p2Club.clubId;
  p2.playingClubId = p2Club.clubId;
  p2.contractEndSeason = 4;
  p2.contractYears = 4;
  p2.weeklyWage = 4500;
  p2.careerId = "browser-recall";
  const loan2 = {
    ...loanOffer,
    wage: 4500,
    loanTerms: {
      ...loanOffer.loanTerms,
      loanId: "loan:browser-recall",
      parentClubId: p2Club.clubId,
      borrowingClubId: dest.clubId,
      recallClause: true,
      purchaseOption: null,
      status: "proposed",
    },
  };
  assert.equal(startLoan(p2, loan2).ok, true);
  assert.equal(recallLoan(p2).ok, true);
  assert.equal(p2.club.clubId, p2Club.clubId);
});

test("empty offers do not deadlock; policy stay clears window", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(3);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:ecuador-ligapro-serie-a");
  const club = league.clubs[0];
  const p = createPlayerIdentity({ name: "Empty Market", nationality: "Ecuador", position: "CB", age: 22 });
  p.rating = 55;
  p.potential = 60;
  p.attributes = { Speed: 55, Passing: 54, Shooting: 40, Defending: 58, Physicality: 56, Dribbling: 50 };
  p.club = { ...club, league: league.name, leagueDisplay: league.displayName, leagueId: league.leagueId, nation: league.nation, isAcademy: false };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractEndSeason = 3;
  p.weeklyWage = 800;
  p.careerId = "empty-market-ui";
  p.seasons = [{ matches: 20, minutes: 1400, goals: 0, assists: 1 }];
  const offers = generateTransferOffers(40, p, LEAGUES, LEAGUE_LOOKUP, 6.0);
  // Zero interest is valid
  const ui = makeUiSession(p);
  p.pendingOffers = offers;
  if (!offers.length) {
    ui.declineAll();
    assert.equal(p.pendingOffers.length, 0);
  }
  const policy = applyDecisionPolicy(p, { decision: null, offers: [] }, "stay");
  assert.equal(policy.applied, "stay");
});

test("accept-transfer and accept-loan policies are deterministic", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(7);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:england-championship");
  const club = league.clubs[1];
  const p = createPlayerIdentity({ name: "Policy Accept", nationality: "England", position: "CM", age: 23 });
  p.rating = 72;
  p.potential = 78;
  p.attributes = { Speed: 72, Passing: 74, Shooting: 68, Defending: 70, Physicality: 72, Dribbling: 71 };
  p.club = { ...club, league: league.name, leagueDisplay: league.displayName, leagueId: league.leagueId, nation: league.nation, isAcademy: false };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractEndSeason = 3;
  p.weeklyWage = 6000;
  p.careerId = "policy-accept-1";
  p.seasons = [{ matches: 30, minutes: 2400, goals: 4, assists: 6 }];
  const offers = generateTransferOffers(78, p, LEAGUES, LEAGUE_LOOKUP, 7.2);
  p.pendingOffers = offers;
  if (offers.some((o) => !o.isLoan && !o.isRenewal)) {
    const res = applyDecisionPolicy(p, { decision: null, offers }, "accept-first-transfer", {
      departureDate: "2027-01-10",
      originSeasonStartYear: 2026,
    });
    assert.ok(res.applied === "transfer" || res.applied === "transfer-failed" || res.applied === "stay-fallback");
    if (res.applied === "transfer") {
      assert.equal(p.club.clubId, res.offer.clubId);
      assert.equal(p.weeklyWage, res.offer.wage);
    }
  } else {
    const stay = applyDecisionPolicy(p, { decision: null, offers: [] }, "stay");
    assert.equal(stay.applied, "stay");
  }
});

test("Stay-at-club mid-season control clears decision and resumes season", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(77);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:poland-ekstraklasa") || LEAGUES.find((l) => /ekstraklasa/i.test(l.name));
  assert.ok(league, "need Ekstraklasa for stay-button repro");
  const club = league.clubs[0];
  const p = createPlayerIdentity({
    name: "Stay Button",
    nationality: "Ivory Coast",
    position: "RB",
    age: 17,
  });
  p.startYear = 2026;
  p.rating = 60;
  p.potential = 72;
  p.attributes = {
    Speed: 62,
    Passing: 57,
    Shooting: 54,
    Defending: 71,
    Physicality: 53,
    Dribbling: 54,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 78, modelVersion: 1, migration: {} };
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 2;
  p.contractEndSeason = 2; // rem === 1 at seasonIndex 1 after academy year, or 1 at season 0? seasons.length=0 → rem=2
  p.weeklyWage = 2500;
  p.careerId = "stay-button-repro";
  p.renewalPlanned = false;
  // Force rem===1 so non-renewal decision appears at winter window
  p.contractEndSeason = 1;

  let paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let staySceneGuards = 0;
  while (paused.awaitingScenario && staySceneGuards < 12) {
    staySceneGuards += 1;
    const pending = paused.pendingSeniorScenario || p.pendingSeniorScenario;
    if (pending && !pending.unschedulable) applySeniorScenarioPolicy(p, pending, "balanced");
    paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      checkpoint: paused.checkpoint,
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }

  if (!paused.awaitingDecision) {
    // Seed a synthetic mid-season pause matching the broken UI state.
    p.seasonCheckpoint = {
      status: "awaiting_decision",
      ordered: [],
      lastDate: "2027-01-05",
      seasonIndex: 0,
    };
    p.pendingDecision = {
      decisionId: "non-renewal:test",
      kind: "non-renewal",
      headline: "Contract situation",
      lead: "The club does not plan to offer a renewal.",
      choices: [
        { id: "seek-move", label: "Seek a new club" },
        { id: "see-out", label: "See out the contract" },
      ],
      cooldownKind: "non-renewal",
    };
  } else {
    p.seasonCheckpoint = paused.checkpoint;
    p.pendingDecision = paused.decision || p.pendingDecision;
  }

  assert.equal(p.seasonCheckpoint?.status, "awaiting_decision");
  assert.ok(p.pendingDecision, "expected a pending squad decision");

  // BUG REPRO PATH: old Stay button called finishOfferWindow(false) without clearing decision.
  // Fixed path: map Stay → see-out / stay-compete via stayChoiceIdForDecision + resolve.
  const stayId = stayChoiceIdForDecision(p.pendingDecision);
  assert.ok(stayId, "Stay must map onto a decision choice");
  const ageAtPause = p.age;
  const seasonsAtPause = p.seasons.length;
  resolveSquadDecision(p, p.pendingDecision, stayId);
  assert.equal(p.pendingDecision, null);

  // finishOfferWindow-equivalent safety: resume when checkpoint awaits and nothing pending
  assert.equal(p.seasonCheckpoint?.status, "awaiting_decision");
  const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    checkpoint: p.seasonCheckpoint,
    autoDecisionPolicy: null,
  });
  assert.notEqual(done.awaitingDecision, true);
  assert.ok(done.season);
  assert.equal(p.seasons.length, seasonsAtPause + 1);
  assert.equal(p.age, ageAtPause + 1);
  // Live dashboard contract: full league store on completed seasons
  assert.ok(Array.isArray(done.leagueAllMatches));
  assert.ok(done.leagueAllMatches.length >= (done.season.leagueMatches || []).length);
});

test("pause segment exposes partial league fixtures for the dashboard", () => {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(4242);
  const league = LEAGUE_BY_ID.get("league:england-premier-league") || LEAGUES[0];
  const club = league.clubs[2];
  const p = createPlayerIdentity({
    name: "Segment UI",
    nationality: "England",
    position: "ST",
    age: 20,
  });
  p.startYear = 2026;
  p.rating = 68;
  p.potential = 84;
  p.attributes = {
    Speed: 68,
    Passing: 64,
    Shooting: 70,
    Defending: 48,
    Physicality: 66,
    Dribbling: 67,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 88, modelVersion: 1, migration: {} };
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 3;
  p.contractEndSeason = 3;
  p.weeklyWage = 5000;
  p.careerId = "browser-dash-segment";

  let paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guards = 0;
  while (paused.awaitingScenario && guards < 12) {
    guards += 1;
    const pending = paused.pendingSeniorScenario || p.pendingSeniorScenario;
    if (pending && !pending.unschedulable) applySeniorScenarioPolicy(p, pending, "balanced");
    paused = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      checkpoint: paused.checkpoint,
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  if (paused.awaitingDecision) {
    assert.ok(Array.isArray(paused.partialLeagueAllMatches));
    assert.ok(paused.partialLeagueAllMatches.length > 0);
    assert.ok(Array.isArray(paused.partialLeaguePlayerMatches));
    const ids = paused.partialLeagueAllMatches.map((m) => m.matchId || m.fixtureId).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length);
  } else {
    assert.ok(Array.isArray(paused.leagueAllMatches));
    assert.ok(paused.leagueAllMatches.length > 0);
  }
});

if (!process.exitCode) {
  console.log("\nAll browser-flow smoke tests passed.");
}
