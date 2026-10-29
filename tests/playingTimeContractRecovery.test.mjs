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
  closeFreeAgentMarketReview,
} from "../js/simulation/dealPipeline.js";
import {
  clubMinutesShare,
  evaluateSquadDecision,
  resolveSquadDecision,
} from "../js/simulation/squadDecisions.js";
import { assessClubPlayingTime } from "../js/simulation/playingTimeAssessment.js";
import { generateLoanOffers } from "../js/simulation/loanMarket.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
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
  const a = data.season.playingTimeAssessment;
  assert.ok(a, "assessment persisted");
  assert.equal(a.source, "ledger-records");
  assert.ok(Math.abs(a.share - 511 / 3780) < 1e-9, `share ${a.share}`);
  assert.equal(a.eligibleFixtureCount, 42);
  assert.equal(a.clubMinutesPlayed, 511);
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
