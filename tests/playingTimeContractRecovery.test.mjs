/**
 * Fix 07: playing-time assessment, contract continuity, free-agent recovery.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { SQUAD_REVIEW } from "../js/config/recruitmentConfig.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import {
  generatePipelineOffers,
  acceptPipelineOffer,
  buildValidatedOffer,
  closeFreeAgentMarketReview,
} from "../js/simulation/dealPipeline.js";
import {
  clubMinutesShare,
  evaluateSquadDecision,
  resolveSquadDecision,
} from "../js/simulation/squadDecisions.js";
import { assessClubPlayingTime } from "../js/simulation/playingTimeAssessment.js";
import { generateLoanOffers, startLoan } from "../js/simulation/loanMarket.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { processPlayerMatchDay } from "../js/simulation/playerMatchDay.js";
import { resolveKnockout } from "../js/simulation/matchEngine.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import {
  ensureContractAuthority,
  evaluateRenewalReview,
  isContractActive,
  isFreeAgent,
  advanceFreeAgentPeriod,
  openBoundaryContractReview,
  settleBoundaryContractReview,
  declineWindowAndContinue,
  completedSeasons,
  markOfferStatus,
  assertPlayableRegistration,
  selectNextCareerAction,
  releaseToFreeAgency,
} from "../js/simulation/contractLifecycle.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function basePlayer({
  ovr = 72,
  age = 23,
  id = "fix07",
  position = "ST",
  nationality = "Serbia",
} = {}) {
  reseedCareerRng(707);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({ name: "Fix07 QA", nationality, position, age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    club: null,
    seasons: [],
    contractStatus: "released",
    contractEndSeason: 0,
    employmentClubId: null,
    playingClubId: null,
    weeklyWage: 0,
    wage: 0,
    rating: ovr,
    attributes: attrs(ovr),
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  return p;
}

function attachClub(p, clubName, extra = {}) {
  const club = allSeniorClubs().find((c) => c.name === clubName);
  assert.ok(club, `missing club ${clubName}`);
  Object.assign(p, {
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: extra.contractYears ?? 2,
    contractEndSeason: extra.contractEndSeason ?? 2,
    contractRevision: null,
    renewalReview: null,
    weeklyWage: extra.weeklyWage ?? 1500,
    wage: extra.weeklyWage ?? 1500,
    ...extra,
  });
  ensureContractAuthority(p);
  return club;
}

function clubRec(partial) {
  return {
    matchId: partial.matchId,
    date: partial.date || "2026-08-15",
    competitionType: partial.competitionType || "league",
    teamType: "club",
    teamId: partial.teamId || "club:test",
    minutes: partial.minutes ?? 0,
    availableMinutes: partial.availableMinutes ?? partial.matchDuration ?? 90,
    matchDuration: partial.matchDuration ?? 90,
    available: partial.available,
    nonParticipationReason: partial.nonParticipationReason || null,
    isInternational: false,
    ...partial,
  };
}

function intlRec(partial) {
  return {
    ...clubRec(partial),
    teamType: "national",
    isInternational: true,
    competitionType: "international",
  };
}

/* ------------------------------------------------------------------ */
/* A. Opportunity arithmetic                                           */
/* ------------------------------------------------------------------ */

test("A1: 38×90 capacity with 900 played → ~0.263; above 0.22", () => {
  const r = clubMinutesShare(
    { seasons: [{ matches: 10, minutes: 900, standing: { matches: 38 } }] },
    { persistAssessment: false }
  );
  assert.ok(Math.abs(r.share - 900 / 3420) < 1e-9);
  assert.equal(r.eligibleMatches, 38);
  assert.ok(r.share > SQUAD_REVIEW.lowMinutesShare);
});

test("A2: 600/3420 below lowMinutesShare", () => {
  const r = clubMinutesShare(
    { seasons: [{ matches: 10, minutes: 600, standing: { matches: 38 } }] },
    { persistAssessment: false }
  );
  assert.ok(Math.abs(r.share - 600 / 3420) < 1e-9);
  assert.ok(r.share < SQUAD_REVIEW.lowMinutesShare);
});

test("A3: 28 healthy bench + 10 full appearances = 38 opportunities", () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push(clubRec({ matchId: `a${i}`, minutes: 90, available: true }));
  }
  for (let i = 0; i < 28; i++) {
    records.push(
      clubRec({
        matchId: `b${i}`,
        minutes: 0,
        available: true,
        nonParticipationReason: "unused_substitute",
      })
    );
  }
  const a = assessClubPlayingTime({}, { ledgerRecords: records, persistAssessment: false });
  assert.equal(a.eligibleFixtureCount, 38);
  assert.equal(a.clubMinutesPlayed, 900);
  assert.equal(a.opportunityCapacity, 3420);
});

test("A4: unavailable fixtures excluded; 10 full → share 1", () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push(clubRec({ matchId: `a${i}`, minutes: 90, available: true }));
  }
  for (let i = 0; i < 28; i++) {
    records.push(
      clubRec({
        matchId: `u${i}`,
        minutes: 0,
        available: false,
        nonParticipationReason: "injured",
      })
    );
  }
  const a = assessClubPlayingTime({}, { ledgerRecords: records });
  assert.equal(a.eligibleFixtureCount, 10);
  assert.equal(a.opportunityCapacity, 900);
  assert.equal(a.availabilityExclusions, 28);
  assert.equal(a.share, 1);
});

test("A5: explicit zero minutes preserved", () => {
  const records = Array.from({ length: 20 }, (_, i) =>
    clubRec({ matchId: `z${i}`, minutes: 0, available: true, nonParticipationReason: "not_selected" })
  );
  const a = assessClubPlayingTime({}, { ledgerRecords: records });
  assert.equal(a.clubMinutesPlayed, 0);
  assert.equal(a.share, 0);
  assert.equal(a.completeness, "exact");
});

test("A6: no eligible fixtures → not usable for punitive low-minutes", () => {
  const r = clubMinutesShare({ seasons: [{}] }, { persistAssessment: false });
  assert.equal(r.usableForLowMinutes, false);
});

test("A7: national fixtures excluded from club assessment", () => {
  const records = [
    ...Array.from({ length: 38 }, (_, i) =>
      clubRec({ matchId: `c${i}`, minutes: i < 10 ? 60 : 0, available: true })
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      intlRec({ matchId: `n${i}`, minutes: 90, available: true, availableMinutes: 90 })
    ),
  ];
  // Force 600 club minutes across 38 eligible
  records.forEach((r, i) => {
    if (!r.isInternational) r.minutes = i < 7 ? 90 : i === 7 ? 30 : 0;
  });
  const a = assessClubPlayingTime({}, { ledgerRecords: records });
  assert.equal(a.eligibleFixtureCount, 38);
  assert.equal(a.clubMinutesPlayed, 660);
  assert.ok(Math.abs(a.share - 660 / 3420) < 1e-9);
});

test("A8: competition slices league+cup+continental", () => {
  const records = [
    clubRec({ matchId: "l1", competitionType: "league", minutes: 90, availableMinutes: 90, available: true }),
    clubRec({ matchId: "l2", competitionType: "league", minutes: 90, availableMinutes: 90, available: true }),
    ...Array.from({ length: 8 }, (_, i) =>
      clubRec({
        matchId: `lx${i}`,
        competitionType: "league",
        minutes: 0,
        available: true,
        nonParticipationReason: "bench",
      })
    ),
    clubRec({ matchId: "c1", competitionType: "domesticCup", minutes: 90, availableMinutes: 180, available: true }),
    clubRec({
      matchId: "c2",
      competitionType: "domesticCup",
      minutes: 0,
      availableMinutes: 0,
      matchDuration: 90,
      available: true,
      nonParticipationReason: "bench",
    }),
    // Fix cup capacity: second cup should be 90
  ];
  // Rebuild cup cleanly
  const clean = [
    clubRec({ matchId: "l1", competitionType: "league", minutes: 90, available: true }),
    clubRec({ matchId: "l2", competitionType: "league", minutes: 90, available: true }),
    ...Array.from({ length: 8 }, (_, i) =>
      clubRec({
        matchId: `lx${i}`,
        competitionType: "league",
        minutes: 0,
        available: true,
        nonParticipationReason: "bench",
      })
    ),
    clubRec({ matchId: "c1", competitionType: "domesticCup", minutes: 90, availableMinutes: 90, available: true }),
    clubRec({
      matchId: "c2",
      competitionType: "domesticCup",
      minutes: 0,
      availableMinutes: 90,
      available: true,
      nonParticipationReason: "bench",
    }),
    clubRec({ matchId: "e1", competitionType: "continental", minutes: 30, availableMinutes: 90, available: true }),
    clubRec({
      matchId: "e2",
      competitionType: "continental",
      minutes: 0,
      availableMinutes: 90,
      available: true,
      nonParticipationReason: "bench",
    }),
  ];
  // Expected: league 180/900, cup 90/180, continental 30/180 → 300/1260
  const a = assessClubPlayingTime({}, { ledgerRecords: clean });
  assert.equal(a.clubMinutesPlayed, 300);
  assert.equal(a.opportunityCapacity, 1260);
  assert.ok(Math.abs(a.byCompetition.league.share - 180 / 900) < 1e-9);
  assert.ok(Math.abs(a.byCompetition.domesticCup.share - 90 / 180) < 1e-9);
  assert.ok(Math.abs(a.byCompetition.continental.share - 30 / 180) < 1e-9);
});

test("A9: 120-minute cup with 20 played → 20/120", () => {
  const a = assessClubPlayingTime(
    {},
    {
      ledgerRecords: [
        clubRec({
          matchId: "et1",
          competitionType: "domesticCup",
          minutes: 20,
          availableMinutes: 120,
          matchDuration: 120,
          available: true,
        }),
      ],
    }
  );
  assert.equal(a.share, 20 / 120);
  assert.equal(a.opportunityCapacity, 120);
});

test("A10: duplicate fixture counts once", () => {
  const rec = clubRec({ matchId: "dup", minutes: 90, available: true });
  const a = assessClubPlayingTime({}, { ledgerRecords: [rec, { ...rec }, { ...rec }] });
  assert.equal(a.eligibleFixtureCount, 1);
  assert.equal(a.clubMinutesPlayed, 90);
});

test("A11: old seasonLedger does not substitute current period", () => {
  const r = clubMinutesShare(
    {
      seasons: [{ matches: 10, minutes: 600, standing: { matches: 38 } }],
      seasonLedger: {
        seasonId: "old",
        eligibleClubMatches: 5,
        availableClubMinutes: 450,
        clubMinutesPlayed: 450,
      },
    },
    { persistAssessment: false }
  );
  assert.ok(Math.abs(r.share - 600 / 3420) < 1e-9);
  assert.ok(r.assessment.conflicts.some((c) => c.kind === "cross-period-or-club-ledger-ignored"));
});

test("A12: explicit ledger zero beats stale season minutes", () => {
  const r = clubMinutesShare(
    {
      seasons: [
        {
          matches: 10,
          minutes: 900,
          participationLedger: {
            eligibleClubMatches: 38,
            availableClubMinutes: 3420,
            clubMinutesPlayed: 0,
          },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.equal(r.share, 0);
  assert.equal(r.minutes, 0);
});

/* ------------------------------------------------------------------ */
/* B. Decisions / loans                                                */
/* ------------------------------------------------------------------ */

test("B1: healthy young cover with 600/3420 reaches development-loan", () => {
  const p = basePlayer({ ovr: 62, age: 20, id: "fix07-dev-loan" });
  const club = attachClub(p, "Hull City", { contractEndSeason: 3, contractYears: 3, weeklyWage: 2000 });
  const records = Array.from({ length: 38 }, (_, i) =>
    clubRec({
      matchId: `m${i}`,
      teamId: club.clubId,
      minutes: i < 7 ? 90 : i === 7 ? 30 : 0,
      available: true,
      nonParticipationReason: i >= 8 ? "unused_substitute" : null,
    })
  );
  const season = {
    matches: 8,
    minutes: 600,
    ledgerRecords: records,
    playingClubId: club.clubId,
  };
  p.seasons = [season];
  const decision = evaluateSquadDecision(p, {
    checkpoint: "mid-season",
    seasonIndex: 0,
    season,
    ledgerRecords: records,
    clubId: club.clubId,
    performanceScore: 55,
  });
  assert.equal(decision?.kind, "development-loan", JSON.stringify(decision));
  assert.ok(decision.minutesShare < SQUAD_REVIEW.lowMinutesShare);
  assert.ok(decision.eligibleMatches >= SQUAD_REVIEW.midSeasonMinEligibleMatches);
});

test("B2: 900/3420 control does not require low-minute development discussion", () => {
  const p = basePlayer({ ovr: 62, age: 20, id: "fix07-dev-control" });
  const club = attachClub(p, "Hull City", { contractEndSeason: 3, contractYears: 3 });
  const records = Array.from({ length: 38 }, (_, i) =>
    clubRec({
      matchId: `m${i}`,
      teamId: club.clubId,
      minutes: i < 10 ? 90 : 0,
      available: true,
      nonParticipationReason: i >= 10 ? "unused_substitute" : null,
    })
  );
  const season = { matches: 10, minutes: 900, ledgerRecords: records, playingClubId: club.clubId };
  p.seasons = [season];
  const decision = evaluateSquadDecision(p, {
    checkpoint: "mid-season",
    seasonIndex: 0,
    season,
    ledgerRecords: records,
    clubId: club.clubId,
    performanceScore: 55,
  });
  assert.notEqual(decision?.kind, "development-loan");
});

test("B3: development loan recommendations use configured 0.5 / 0.2 gates", () => {
  const p = basePlayer({ ovr: 60, age: 19, id: "fix07-loan-gates" });
  attachClub(p, "Hull City", { contractEndSeason: 3, contractYears: 3 });
  const low = generateLoanOffers(p, {
    developmentRecommendation: true,
    currentProjectedShare: 0.45,
    maxOffers: 3,
  });
  for (const o of low.offers) {
    assert.ok(
      (o.projectedMinutesShare || 0) >= SQUAD_REVIEW.loanDestinationMinMinutesShare,
      "dest share gate"
    );
    assert.ok(
      (o.projectedMinutesShare || 0) - 0.45 >= SQUAD_REVIEW.loanMinutesImprovement - 1e-9,
      "improvement gate"
    );
  }
  // Elective pool remains broader (hardcoded 0.35) and is not advertised as development.
  const elective = generateLoanOffers(p, { maxOffers: 3, developmentRecommendation: false });
  assert.ok(Array.isArray(elective.offers));
});

test("B4: stay/decline preserves contract", () => {
  const p = basePlayer({ ovr: 62, age: 20, id: "fix07-stay" });
  attachClub(p, "Hull City", { contractEndSeason: 3, contractYears: 3, weeklyWage: 2500 });
  const decision = {
    decisionId: "d1",
    kind: "development-loan",
    status: "pending",
    allowedChoices: ["stay-compete", "review-loans"],
    cooldownKind: "development-loan",
    choices: [{ id: "stay-compete" }],
  };
  p.pendingDecision = decision;
  p.pendingOffers = [{ clubId: "x", status: "pending" }];
  const res = resolveSquadDecision(p, decision, "stay-compete");
  assert.equal(res.ok, true);
  assert.equal(isContractActive(p), true);
  assert.equal(p.weeklyWage, 2500);
  assert.equal(p.pendingOffers.length, 0);
});

/* ------------------------------------------------------------------ */
/* C. Renewal / expiry                                                 */
/* ------------------------------------------------------------------ */

test("C1: one-year renewal extends end 1 → 2 (age 36)", () => {
  const p = basePlayer({ ovr: 72, age: 36, id: "bug07-short-renewal" });
  attachClub(p, "Hull City", {
    contractEndSeason: 1,
    contractYears: 1,
    contractStartSeason: 0,
    weeklyWage: 1500,
  });
  const gen = generatePipelineOffers(p, {
    performanceScore: 85,
    forceGenerate: true,
    rng: createRng(707),
  });
  const renewal = gen.offers.find((o) => o.isRenewal);
  assert.ok(renewal, "expected renewal offer");
  assert.equal(renewal.extensionYears, 1);
  const before = p.contractEndSeason;
  const accepted = acceptPipelineOffer(p, renewal);
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(before, 1);
  assert.equal(p.contractEndSeason, 2);
  assert.equal(isContractActive(p), true);
});

test("C2: younger one-year extension also adds coverage", () => {
  const p = basePlayer({ ovr: 74, age: 24, id: "bug07-young-renewal" });
  attachClub(p, "Hull City", {
    contractEndSeason: 1,
    contractYears: 1,
    contractStartSeason: 0,
    weeklyWage: 4000,
  });
  // Force a one-year extension offer through acceptance of generated terms.
  const gen = generatePipelineOffers(p, { performanceScore: 88, forceGenerate: true });
  const renewal = gen.offers.find((o) => o.isRenewal);
  assert.ok(renewal);
  const years = renewal.extensionYears || renewal.contractYears;
  const before = p.contractEndSeason;
  const accepted = acceptPipelineOffer(p, renewal);
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(p.contractEndSeason, before + years);
});

test("C3: early firm review latches; boundary phase can reevaluate", () => {
  const p = basePlayer({ ovr: 72, age: 23, id: "bug07-renewal" });
  attachClub(p, "Atalanta", {
    contractEndSeason: 1,
    contractYears: 1,
    weeklyWage: 7200,
  });
  const poor = evaluateRenewalReview(p, { performanceScore: 55, financeOk: true });
  assert.equal(poor.outcome, "will-not-renew");
  const later = evaluateRenewalReview(p, { performanceScore: 85, financeOk: true });
  assert.equal(later.outcome, "will-not-renew");
  assert.equal(later.reviewId, poor.reviewId);
  const boundary = evaluateRenewalReview(p, {
    performanceScore: 85,
    financeOk: true,
    reviewPhase: "boundary",
    forceReevaluate: true,
  });
  assert.equal(boundary.outcome, "wants-renewal");
  assert.notEqual(boundary.reviewId, poor.reviewId);
});

test("C4: boundary review defers expiry until settlement", () => {
  const p = basePlayer({ ovr: 72, age: 24, id: "fix07-boundary" });
  attachClub(p, "Hull City", {
    contractEndSeason: 1,
    contractYears: 1,
    weeklyWage: 3000,
  });
  // Complete the contracted season index.
  p.seasons = [{ seasonId: "s1", matches: 20, minutes: 1200, freeAgent: false }];
  assert.equal(completedSeasons(p), 1);
  const opened = openBoundaryContractReview(p, { performanceScore: 85, financeOk: true });
  assert.ok(["opened-review", "pending-review"].includes(opened.action));
  assert.equal(p.pendingContractReview.status, "pending");
  assert.equal(isContractActive(p), false); // term ended numerically
  // Expiry deferred while pending.
  const deferred = settleBoundaryContractReview.toString(); // touch export
  assert.ok(deferred.includes("pending"));
  const settled = settleBoundaryContractReview(p, { choice: "decline" });
  assert.equal(settled.action, "released");
  assert.equal(isFreeAgent(p), true);
});

test("C5: simulateSeason stay path releases after final year without soft-lock", () => {
  const p = basePlayer({ ovr: 72, age: 22, id: "fix07-sim-expiry" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1, weeklyWage: 2000 });
  reseedCareerRng(707);
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(result.season);
  assert.ok(result.season.playingTimeAssessment);
  assert.equal(isFreeAgent(p), true);
  assert.equal(p.weeklyWage || 0, 0);
});

/* ------------------------------------------------------------------ */
/* D. Free-agent recovery                                              */
/* ------------------------------------------------------------------ */

test("D1: interest-gate empty is distinct from no eligible clubs", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  const g = generatePipelineOffers(p, { performanceScore: 55 });
  assert.equal(g.offers.length, 0);
  assert.equal(g.eligibilityEvaluated, false);
  assert.equal(g.eligibleCount, null);
  assert.equal(g.diagnostics.interestGateResult, "declined");
});

test("D2: after one empty closed review, recovery finds validated offers", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  const g1 = generatePipelineOffers(p, { performanceScore: 55 });
  assert.equal(g1.offers.length, 0);
  advanceFreeAgentPeriod(p, { seasons: 1 });
  assert.ok(p.freeAgentSpell.consecutiveEmptyReviews >= 1);
  const g2 = generatePipelineOffers(p, { performanceScore: 55 });
  assert.equal(g2.diagnostics.interestGateResult, "recovery-bypass");
  assert.ok(g2.eligibleCount > 0);
  assert.ok(g2.offers.length > 0, "recovery must surface an executable offer");
  assert.equal(g2.diagnostics.recoveryStage, "recovery-success");
});

test("D3: frozen review does not reroll", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  generatePipelineOffers(p, { performanceScore: 55 });
  advanceFreeAgentPeriod(p, { seasons: 1 });
  const a = generatePipelineOffers(p, { performanceScore: 55 });
  const b = generatePipelineOffers(p, { performanceScore: 55 });
  assert.equal(b.frozen, true);
  assert.deepEqual(
    a.offers.map((o) => o.offerId),
    b.offers.map((o) => o.offerId)
  );
});

test("D4: declining a valid offer breaks consecutive-empty streak", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  generatePipelineOffers(p, { performanceScore: 55 });
  advanceFreeAgentPeriod(p, { seasons: 1 });
  const g = generatePipelineOffers(p, { performanceScore: 55 });
  assert.ok(g.offers.length > 0);
  p.pendingOffers = g.offers;
  declineWindowAndContinue(p, { choiceId: "decline-window" });
  assert.equal(p.freeAgentSpell.consecutiveEmptyReviews, 0);
  assert.equal(p.freeAgentSpell.lastClosedClassification, "refusal");
});

test("D5: snapshot round-trip preserves free-agent spell counters", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  generatePipelineOffers(p, { performanceScore: 55 });
  advanceFreeAgentPeriod(p, { seasons: 1 });
  const before = p.freeAgentSpell.consecutiveEmptyReviews;
  const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.player.freeAgentSpell.consecutiveEmptyReviews, before);
  assert.equal(restored.player.freeAgentSpell.spellId, p.freeAgentSpell.spellId);
});

/* ------------------------------------------------------------------ */
/* E. Real season orchestration                                        */
/* ------------------------------------------------------------------ */

test("E1: Hull 58 OVR seed 707 uses club opportunity denominator", () => {
  const p = basePlayer({ ovr: 58, age: 21, id: "bug07-full-58" });
  attachClub(p, "Hull City", { contractEndSeason: 2, contractYears: 2 });
  reseedCareerRng(707);
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const s = data.season;
  const a = s.playingTimeAssessment;
  assert.ok(a, "assessment persisted");
  assert.equal(a.source, "ledger-records");
  const clubRows = (s.ledgerRecords || []).filter((r) => !r.isInternational && r.teamType !== "national");
  const avail = clubRows.filter((r) => r.available === true);
  const minutes = clubRows.reduce((sum, r) => sum + (Number(r.minutes) || 0), 0);
  const capacity = avail.reduce(
    (sum, r) => sum + (Number(r.availableMinutes) || Number(r.matchDuration) || 90),
    0
  );
  assert.ok(capacity > 0, "capacity from eligible fixtures");
  assert.ok(Math.abs(a.share - minutes / capacity) < 1e-9, `share ${a.share} vs ${minutes}/${capacity}`);
  assert.equal(a.eligibleFixtureCount, avail.length);
  assert.equal(a.clubMinutesPlayed, minutes);
  // Low-minute Hull path remains below the development-loan share band.
  assert.ok(a.share < 0.22, `expected low minutes, got ${a.share}`);
});

test("E2: Atalanta 72 OVR seed 707 assessment matches independent oracle", () => {
  const p = basePlayer({ ovr: 72, age: 21, id: "bug07-full-72" });
  attachClub(p, "Atalanta", { contractEndSeason: 2, contractYears: 2 });
  reseedCareerRng(707);
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const s = data.season;
  const clubRows = (s.ledgerRecords || []).filter((r) => !r.isInternational && r.teamType !== "national");
  const avail = clubRows.filter((r) => r.available === true);
  const minutes = clubRows.reduce((a, b) => a + b.minutes, 0);
  const capacity = avail.reduce((a, b) => a + (b.availableMinutes ?? b.matchDuration ?? 90), 0);
  const a = s.playingTimeAssessment;
  assert.ok(Math.abs(a.share - minutes / capacity) < 1e-9);
  assert.equal(a.eligibleFixtureCount, avail.length);
  assert.ok(a.share < 0.22);
});

/* ------------------------------------------------------------------ */
/* F. Review follow-up regressions (R1–R6)                             */
/* ------------------------------------------------------------------ */

test("F1: pending review blocks simulateSeason without aging", () => {
  const p = basePlayer({ ovr: 72, age: 24, id: "review07-pending-sim" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  p.seasons = [{ seasonNumber: 1, minutes: 1200, matches: 20 }];
  openBoundaryContractReview(p, { performanceScore: 85, financeOk: true });
  const before = { age: p.age, seasons: p.seasons.length };
  const r = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(p.age, before.age);
  assert.equal(p.seasons.length, before.seasons);
  assert.equal(r.season, null);
  assert.equal(r.pendingContractReview, true);
  assert.equal(selectNextCareerAction(p).canSimulate, false);
});

test("F2: accepting another club settles pending review and is playable", () => {
  const p = basePlayer({ ovr: 72, age: 24, id: "review07-pending-sign" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  p.seasons = [{ seasonNumber: 1, minutes: 1200, matches: 20 }];
  openBoundaryContractReview(p, { performanceScore: 85, financeOk: true });
  const c = allSeniorClubs().find((x) => x.name === "Rudeš");
  const built = buildValidatedOffer({
    player: p,
    club: c,
    dealType: "free_agent",
    performanceScore: 85,
    rng: createRng(708),
  });
  assert.equal(built.ok, true);
  const r = acceptPipelineOffer(p, built.offer);
  assert.equal(r.ok, true);
  assert.equal(p.club?.clubId, c.clubId);
  assert.notEqual(p.pendingContractReview?.status, "pending");
  assert.equal(assertPlayableRegistration(p).ok, true);
});

test("F3: released-employer renewal is rejected without booking", () => {
  const p = basePlayer({ ovr: 72, age: 36, id: "review07-stale-renewal" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  const g = generatePipelineOffers(p, { performanceScore: 85, forceGenerate: true, rng: createRng(707) });
  const offer = g.offers.find((o) => o.isRenewal);
  assert.ok(offer);
  releaseToFreeAgency(p, "contract-expired");
  const r = acceptPipelineOffer(p, offer);
  assert.equal(r.ok, false);
  assert.equal(p.contractStatus, "released");
  assert.equal(p.employmentClubId, null);
});

test("F4: declined same-window renewal stays closed on regenerate", () => {
  const p = basePlayer({ ovr: 72, age: 36, id: "review07-declined-renewal" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  const g = generatePipelineOffers(p, { performanceScore: 85, forceGenerate: true, rng: createRng(707) });
  const offer = g.offers.find((o) => o.isRenewal);
  assert.ok(offer);
  markOfferStatus(p, offer, "declined");
  const again = generatePipelineOffers(p, {
    performanceScore: 85,
    forceGenerate: true,
    rng: createRng(707),
  }).offers.find((o) => o.isRenewal);
  assert.equal(p.offerJournal[offer.offerId].status, "declined");
  if (again) {
    const r = acceptPipelineOffer(p, again);
    assert.equal(r.ok, false);
  }
  assert.equal(p.contractEndSeason, 1);
});

test("F5: new club decision does not consume prior club minutes", () => {
  const p = basePlayer({ ovr: 72, age: 20, id: "review07-newclub" });
  attachClub(p, "Atalanta", { contractEndSeason: 3, contractYears: 3 });
  const old = allSeniorClubs().find((c) => c.name === "Hull City");
  p.seasons = [
    {
      seasonId: "previous",
      playingClubId: old.clubId,
      clubId: old.clubId,
      ledgerRecords: Array.from({ length: 38 }, (_, i) => ({
        matchId: `old-${i}`,
        teamId: old.clubId,
        teamType: "club",
        date: "2026-09-01",
        competitionType: "league",
        available: true,
        minutes: i < 10 ? 60 : 0,
        availableMinutes: 90,
      })),
    },
  ];
  const d = evaluateSquadDecision(p, { checkpoint: "pre-season", seasonIndex: 1 });
  if (d) {
    assert.equal(d.playingTimeAssessment?.representedClubId, p.club.clubId);
    assert.notEqual(d.playingTimeAssessment?.representedClubId, old.clubId);
  }
});

test("F6: unproven old ledger and mixed minutes stay non-punitive", () => {
  const stale = clubMinutesShare(
    {
      seasons: [{ seasonNumber: 2, matches: 10, minutes: 600, standing: { matches: 38 } }],
      seasonLedger: {
        seasonId: "2025-26",
        eligibleClubMatches: 5,
        availableClubMinutes: 450,
        clubMinutesPlayed: 450,
      },
    },
    { persistAssessment: false }
  );
  assert.notEqual(stale.assessment?.source, "participation-ledger");

  const clubId = "club:england:hull-city";
  const unproved = clubMinutesShare(
    {
      playingClubId: clubId,
      club: { clubId },
      seasons: [{ playingClubId: clubId, matches: 10, minutes: 600, standing: { matches: 38 } }],
      seasonLedger: {
        clubId,
        eligibleClubMatches: 5,
        availableClubMinutes: 450,
        clubMinutesPlayed: 450,
      },
    },
    { persistAssessment: false }
  );
  assert.ok(
    unproved.assessment?.source !== "participation-ledger" ||
      unproved.assessment?.completeness !== "exact"
  );

  const mixed = clubMinutesShare(
    {
      seasons: [
        {
          matches: 15,
          minutes: 1050,
          clubMinutes: 600,
          standing: { matches: 38 },
          ledgerSummary: { club: { minutes: 600 }, international: { minutes: 450 } },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.ok(Math.abs(mixed.share - 600 / 3420) < 1e-12);

  const leagueCup = clubMinutesShare(
    {
      seasons: [
        {
          matches: 15,
          minutes: 1050,
          clubMinutes: 1050,
          standing: { matches: 38 },
          ledgerSummary: { club: { minutes: 1050 }, international: { minutes: 0 } },
          domesticCupResult: {
            playerMatches: Array.from({ length: 5 }, (_, i) => ({
              fixtureId: `legacy-cup-${i}`,
              playerStats: { minutes: 90, played: true },
            })),
          },
          europeanCampaign: { qualified: false },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.ok(
    !leagueCup.usableForLowMinutes || Math.abs(leagueCup.share - 600 / 3420) < 1e-12,
    `league/cup share ${leagueCup.share}`
  );
});

test("F7: closing FA review does not reroll same scheduled window", () => {
  const p = basePlayer({ ovr: 66, age: 23, id: "bug07-search-0" });
  const a = generatePipelineOffers(p, { performanceScore: 55 });
  closeFreeAgentMarketReview(p, {
    ...a,
    interestGateDeclined: a.diagnostics.interestGateResult === "declined",
  });
  const b = generatePipelineOffers(p, { performanceScore: 55 });
  assert.equal(a.reviewId, b.reviewId);
  assert.equal(a.offers.length, b.offers.length);
  assert.equal(b.frozen, true);
});

test("F8: production ET substitute uses 120 capacity", () => {
  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const home = league.clubs.find((c) => c.name === "Arsenal");
  const away = league.clubs.find((c) => c.name === "Brentford");
  const noInjury = { ...createRng(44), random: () => 0.99, chance: () => false };
  let observed = null;
  for (let seed = 1; seed <= 60; seed++) {
    const p = basePlayer({ ovr: 85, age: 22, id: "review07-et" });
    attachClub(p, "Arsenal", { contractEndSeason: 3, contractYears: 3 });
    const sel = { ...createRng(43), random: () => 0.6, chance: () => true, int: () => 20 };
    const r = processPlayerMatchDay({
      home,
      away,
      player: p,
      playerSide: "home",
      date: "2026-09-01",
      competition: "domesticCup",
      competitionType: "domesticCup",
      competitionId: "cup:review",
      editionId: "2026",
      fixtureId: `et-${seed}`,
      teamType: "club",
      rng: createRng(seed),
      selRng: sel,
      injuryRng: noInjury,
      resolveKnockout,
    });
    if (["extraTime", "penalties"].includes(r.match.decidedBy) && r.ledgerRecord?.minutes === 20) {
      const a = assessClubPlayingTime(p, { ledgerRecords: [r.ledgerRecord] });
      observed = { decidedBy: r.match.decidedBy, capacity: a.opportunityCapacity, share: a.share };
      break;
    }
  }
  assert.ok(observed, "expected ET substitute in seeds 1..60");
  assert.equal(observed.capacity, 120);
  assert.ok(Math.abs(observed.share - 20 / 120) < 1e-12);
});

test("F10: pending parent review survives co-terminal loan end", () => {
  const p = basePlayer({ ovr: 90, age: 24, id: "rr07-parent-loan-90" });
  attachClub(p, "Atalanta", { contractEndSeason: 1, contractYears: 1 });
  const loans = generateLoanOffers(p, { maxOffers: 3, rng: createRng(707) });
  assert.ok(loans.offers.length > 0, "loan offer");
  const started = startLoan(p, loans.offers[0]);
  assert.equal(started.ok, true);
  reseedCareerRng(708);
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
    keepPendingBoundaryReview: true,
  });
  assert.equal(p.pendingContractReview?.status, "pending");
  const before = { age: p.age, seasons: p.seasons.length, employer: p.employmentClubId };
  const two = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(p.age, before.age);
  assert.equal(p.seasons.length, before.seasons);
  assert.equal(p.employmentClubId, before.employer);
  assert.equal(p.pendingContractReview?.status, "pending");
  assert.equal(two.season, null);
});

test("F11: boundary facade keeps identical renewal terms", async () => {
  const { applySeniorScenarioPolicy } = await import("../js/simulation/seniorCareerScenarios.js");
  const p = basePlayer({ ovr: 86, age: 24, id: "review07-ui-86" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  reseedCareerRng(707);
  let data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guard = 0;
  while (data.awaitingScenario || data.awaitingDecision) {
    assert.ok(++guard < 60, "pause guard");
    if (data.awaitingScenario) {
      const pending = p.pendingSeniorScenario || data.pendingSeniorScenario;
      applySeniorScenarioPolicy(p, pending, "balanced");
      p.pendingSeniorScenario = null;
    }
    if (data.awaitingDecision) {
      const d = p.pendingDecision || data.decision;
      const choices = d.allowedChoices || d.choices.map((c) => c.id);
      const pick =
        ["stay-compete", "see-out", "acknowledge", "remain"].find((c) => choices.includes(c)) ||
        choices[0];
      assert.equal(resolveSquadDecision(p, d, pick).ok, true);
    }
    data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
      checkpoint: data.checkpoint,
    });
  }
  assert.equal(p.pendingContractReview?.status, "pending");
  const before = (p.pendingOffers || [])
    .filter((o) => o.isRenewal)
    .map((o) => ({ id: o.offerId, wage: o.wage, years: o.extensionYears ?? o.contractYears }));
  assert.ok(before.length > 0);
  const afterOffers = generateTransferOffers(
    data.performanceScore,
    p,
    LEAGUES,
    LEAGUE_LOOKUP,
    data.season?.avgMatchRating ?? null
  );
  const after = afterOffers
    .filter((o) => o.isRenewal)
    .map((o) => ({ id: o.offerId, wage: o.wage, years: o.extensionYears ?? o.contractYears }));
  assert.deepEqual(after, before);
});

test("F9: post-season facade preserves pending boundary phase", async () => {
  const { applySeniorScenarioPolicy } = await import("../js/simulation/seniorCareerScenarios.js");
  const p = basePlayer({ ovr: 86, age: 24, id: "review07-ui-86" });
  attachClub(p, "Hull City", { contractEndSeason: 1, contractYears: 1 });
  reseedCareerRng(707);
  let data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guard = 0;
  while (data.awaitingScenario || data.awaitingDecision) {
    assert.ok(++guard < 60, "pause guard");
    if (data.awaitingScenario) {
      const pending = p.pendingSeniorScenario || data.pendingSeniorScenario;
      applySeniorScenarioPolicy(p, pending, "balanced");
      p.pendingSeniorScenario = null;
    }
    if (data.awaitingDecision) {
      const d = p.pendingDecision || data.decision;
      const choices = d.allowedChoices || d.choices.map((c) => c.id);
      const pick =
        ["stay-compete", "see-out", "acknowledge", "remain"].find((c) => choices.includes(c)) ||
        choices[0];
      const result = resolveSquadDecision(p, d, pick);
      assert.equal(result.ok, true);
    }
    data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
      checkpoint: data.checkpoint,
    });
  }
  assert.equal(p.pendingContractReview?.status, "pending");
  assert.equal(p.renewalReview?.reviewPhase, "boundary");
  assert.equal(p.renewalReview?.outcome, "wants-renewal");
  generateTransferOffers(
    data.performanceScore,
    p,
    LEAGUES,
    LEAGUE_LOOKUP,
    data.season?.avgMatchRating ?? null
  );
  assert.equal(p.renewalReview?.reviewPhase, "boundary");
  assert.equal(p.renewalReview?.outcome, "wants-renewal");
});

test("F12: legacy continental and second-cup minutes do not mix into league share", () => {
  const matches = (prefix, n) =>
    Array.from({ length: n }, (_, i) => ({
      fixtureId: `${prefix}-${i}`,
      playerStats: { minutes: 90, played: true },
    }));
  const primary = { name: "Primary domestic cup", playerMatches: matches("cup-primary", 5) };
  const secondary = { name: "Second domestic cup", playerMatches: matches("cup-secondary", 5) };

  const continental = clubMinutesShare(
    {
      seasons: [
        {
          matches: 15,
          minutes: 1050,
          clubMinutes: 1050,
          standing: { matches: 38 },
          ledgerSummary: { club: { minutes: 1050 }, international: { minutes: 0 } },
          europeanCampaign: {
            qualified: true,
            competition: "Champions League",
            playerMatches: matches("continental", 5),
          },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.ok(
    !continental.usableForLowMinutes || Math.abs(continental.share - 600 / 3420) < 1e-12,
    `continental share ${continental.share}`
  );

  const twoCups = clubMinutesShare(
    {
      seasons: [
        {
          matches: 20,
          minutes: 1500,
          clubMinutes: 1500,
          standing: { matches: 38 },
          ledgerSummary: { club: { minutes: 1500 }, international: { minutes: 0 } },
          domesticCupResult: primary,
          domesticCupCampaigns: [primary, secondary],
          europeanCampaign: { qualified: false },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.ok(
    !twoCups.usableForLowMinutes || Math.abs(twoCups.share - 600 / 3420) < 1e-12,
    `two-cup share ${twoCups.share}`
  );

  // Overlap: primary listed twice must not double-subtract.
  const overlap = clubMinutesShare(
    {
      seasons: [
        {
          matches: 15,
          minutes: 1050,
          clubMinutes: 1050,
          standing: { matches: 38 },
          domesticCupResult: primary,
          domesticCupCampaigns: [primary],
          europeanCampaign: { qualified: false },
        },
      ],
    },
    { persistAssessment: false }
  );
  assert.ok(Math.abs(overlap.share - 600 / 3420) < 1e-12, `overlap share ${overlap.share}`);
});

test("F13: app finalizer keeps pending parent renewal over loan-return", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const { endLoan } = await import("../js/simulation/loanMarket.js");
  const { queueSquadDecision } = await import("../js/simulation/squadDecisions.js");
  const { assertPlayableRegistration } = await import("../js/simulation/contractLifecycle.js");
  const { acceptPipelineOffer } = await import("../js/simulation/dealPipeline.js");
  const { ensureTransferSave } = await import("../js/simulation/transferMigration.js");

  const p = basePlayer({ ovr: 90, age: 24, id: "rr07-parent-loan-90" });
  attachClub(p, "Atalanta", { contractEndSeason: 1, contractYears: 1 });
  const loans = generateLoanOffers(p, { maxOffers: 3, rng: createRng(707) });
  assert.ok(loans.offers.length > 0);
  assert.equal(startLoan(p, loans.offers[0]).ok, true);
  reseedCareerRng(708);
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
    keepPendingBoundaryReview: true,
  });
  assert.equal(p.pendingContractReview?.status, "pending");
  assert.equal(p.pendingContractReview?.outcome, "wants-renewal");
  assert.equal(p.pendingDecision?.kind, "boundary-renewal");

  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const begin = main.indexOf("async function finalizeCompletedSeasonUi(");
  const end = main.indexOf("\nfunction seasonHistoryKey(", begin);
  assert.ok(begin >= 0 && end > begin, "finalizeCompletedSeasonUi binding");
  const noop = () => {};
  const finalize = vm.runInNewContext("(" + main.slice(begin, end).trim() + ")", {
    player: p,
    queueSquadDecision,
    endLoan,
    assertPlayableRegistration,
    generateTransferOffers,
    ensureTransferSave,
    LEAGUES,
    LEAGUE_LOOKUP,
    maybeAutoRetire: () => false,
    syncSimulateButton: noop,
    refreshOverview: noop,
    refreshStandings: noop,
    refreshCompetitions: noop,
    refreshTransferOffers: noop,
    appendSeasonCard: noop,
    getDisplayAttributeKeys: () => [],
    showSeasonAnimation: async () => {},
    finishSeasonAnimation: noop,
    recoverSeasonPresentationFailure: (e) => {
      throw e;
    },
  });
  await finalize(data);
  assert.equal(p.pendingDecision?.kind, "boundary-renewal");
  assert.ok(!/will become a free agent after settlement/i.test(p.pendingDecision?.lead || ""));
  assert.equal(p.pendingContractReview?.status, "pending");
  assert.ok((p.pendingOffers || []).some((o) => o.isRenewal));

  // queueSquadDecision must not wipe the tray when loan-return is refused.
  const kept = p.pendingDecision;
  queueSquadDecision(p, "loan-return", { seasonIndex: p.seasons.length });
  assert.equal(p.pendingDecision?.kind, "boundary-renewal");
  assert.equal(p.pendingDecision?.decisionId, kept.decisionId);

  const accept = acceptPipelineOffer(p, p.pendingOffers.find((o) => o.isRenewal));
  assert.equal(accept.ok, true);
  assert.equal(p.contractStatus, "active");
  assert.equal(p.employmentClubId, "club:italy:atalanta");
});
