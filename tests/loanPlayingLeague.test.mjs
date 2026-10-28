/**
 * Prompt 5 — loaned player sees borrower's league table/season, not parent's.
 * Run: node tests/loanPlayingLeague.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  simulateChronologicalSeason,
  resumeChronologicalSeason,
} from "../js/simulation/chronologicalSeason.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng, createStreamRng } from "../js/simulation/rng.js";
import {
  startLoan,
  endLoan,
  generateLoanOffers,
  normalizeWageShares,
} from "../js/simulation/loanMarket.js";
import { buildValidatedOffer } from "../js/simulation/dealPipeline.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { evaluateSportingFit } from "../js/simulation/recruitmentModel.js";

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

function makeSeniorInLeague(leagueId, opts = {}) {
  const league = LEAGUE_BY_ID.get(leagueId);
  const club = league.clubs[opts.clubIndex ?? 0];
  const p = createPlayerIdentity({
    name: opts.name || `P-${leagueId}`,
    nationality: opts.nationality || league.nation,
    position: opts.position || "CM",
    age: opts.age ?? 19,
  });
  p.startYear = 2026;
  p.rating = opts.rating ?? 62;
  p.potential = opts.potential ?? 84;
  p.attributes = {
    Speed: p.rating,
    Passing: p.rating + 2,
    Shooting: p.rating - 4,
    Defending: p.rating - 2,
    Physicality: p.rating,
    Dribbling: p.rating + 1,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: p.potential + 2, modelVersion: 1, migration: {} };
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
  p.contractYears = opts.contractYears ?? 4;
  p.contractEndSeason = opts.contractYears ?? 4;
  p.weeklyWage = opts.wage ?? 4000;
  p.careerId = opts.careerId || p.name;
  p.seasons = [];
  return p;
}

function findZwolleOffer(offers) {
  return (offers || []).find(
    (o) =>
      o.clubId === "club:netherlands:pec-zwolle" ||
      /zwolle/i.test(o.club || o.clubDisplay || "")
  );
}

function forceZwolleLoanOffer(player, reviewDate) {
  const zwolle = allSeniorClubs().find((c) => c.clubId === "club:netherlands:pec-zwolle");
  assert.ok(zwolle, "PEC Zwolle must exist");
  const parentId = player.employmentClubId || player.club.clubId;
  const fit = evaluateSportingFit(player, zwolle, {
    careerId: player.careerId,
    relaxedDevelopment: true,
  });
  const built = buildValidatedOffer({
    player,
    club: zwolle,
    fit: {
      ...fit,
      eligible: true,
      pathway: "loan",
      projection: {
        role: "rotation",
        minutesShare: 0.55,
        minutesRange: [40, 70],
        gap: -1,
        benchmark: 62,
      },
    },
    dealType: "loan",
    performanceScore: 62,
    loanTerms: {
      loanFee: 150_000,
      borrowerWageShare: 0.6,
      parentWageShare: 0.4,
      parentClubId: parentId,
      recallClause: false,
      purchaseOption: null,
    },
  });
  assert.equal(built.ok, true, String(built.reasons));
  const endSeason = Math.min(
    player.contractEndSeason ?? 4,
    (player.seasons?.length ?? 0) + 1
  );
  const offer = {
    ...built.offer,
    dealType: "loan",
    isLoan: true,
    reviewDate,
    effectiveDate: reviewDate,
    loanTerms: {
      ...built.offer.loanTerms,
      loanId: `loan:test:${player.careerId}:pec-zwolle`,
      parentClubId: parentId,
      borrowingClubId: zwolle.clubId,
      startSeason: player.seasons?.length ?? 0,
      endSeason,
      startDate: reviewDate,
      endDate: "2027-06-30",
      status: "proposed",
      international: true,
      agreedGrossWeekly: built.offer.wage,
    },
    registration: resolveMoveRegistration({
      destinationLeagueId: zwolle.leagueId,
      departureDate: reviewDate,
      originSeasonStartYear: player.startYear || 2026,
    }),
  };
  return offer;
}

test("Atalanta → PEC Zwolle resume returns 18-club Eredivisie table with Zwolle row", () => {
  const fixture = buildLiveLoanBrowserFixture();
  assert.equal(fixture.ok, true, fixture.reason);
  const { player, decision, checkpoint } = fixture;
  const parentId = player.employmentClubId || player.club.clubId;
  assert.ok(/atalanta/i.test(player.club.name) || parentId.includes("atalanta"));

  let offer = findZwolleOffer(decision?.loanOffers) || findZwolleOffer(player.pendingOffers);
  if (!offer) {
    offer = forceZwolleLoanOffer(player, checkpoint.lastDate || "2027-01-10");
  }
  assert.equal(offer.clubId, "club:netherlands:pec-zwolle");

  const contractEnd = player.contractEndSeason;
  const wageBefore = player.weeklyWage;
  const ageAtPause = player.age;
  const seasonsBefore = player.seasons.length;

  const started = startLoan(player, offer);
  assert.equal(started.ok, true, started.reason);
  assert.equal(player.employmentClubId, parentId);
  assert.equal(player.playingClubId, "club:netherlands:pec-zwolle");
  assert.equal(player.club.clubId, "club:netherlands:pec-zwolle");
  assert.equal(player.contractEndSeason, contractEnd);

  player.pendingOffers = [];
  player.pendingDecision = null;

  const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    checkpoint,
    pauseForDecisions: false,
  });
  assert.ok(seasonData?.season, "season must complete");
  assert.notEqual(seasonData.awaitingDecision, true);

  const { season, league, standings } = seasonData;
  assert.equal(league.leagueId, "league:netherlands-eredivisie");
  assert.equal(season.leagueId, "league:netherlands-eredivisie");
  assert.match(String(season.leagueDisplay || league.displayName), /Eredivisie/i);
  assert.equal(season.playingClubId, "club:netherlands:pec-zwolle");
  assert.equal(season.employmentClubId, parentId);
  assert.equal(player.employmentClubId, parentId);
  assert.equal(player.playingClubId, "club:netherlands:pec-zwolle");

  assert.equal(standings.table.length, 18);
  for (const row of standings.table) {
    assert.equal(row.played, 34, `${row.name} should have 34 matches`);
  }
  const zwolleRow =
    standings.playerRecord ||
    standings.table.find((r) => r.clubId === "club:netherlands:pec-zwolle");
  assert.ok(zwolleRow, "PEC Zwolle must appear as player row");
  assert.equal(zwolleRow.clubId, "club:netherlands:pec-zwolle");
  assert.ok(!standings.table.some((r) => /atalanta/i.test(r.name)));

  const segments = season.leagueMatchSegments || [];
  assert.ok(segments.length >= 1, "expected league match segments");
  const originSeg = segments.find((s) => s.segment === "origin");
  const destSeg = segments.find(
    (s) => s.segment === "destination" || s.leagueId === "league:netherlands-eredivisie"
  );
  if (originSeg) {
    assert.match(String(originSeg.label), /before move/i);
    assert.ok(originSeg.matches.every((m) => Number(m.matchday) < 100000));
  }
  assert.ok(destSeg, "destination segment required");
  for (const m of season.leagueMatches || []) {
    assert.ok(Number(m.matchday) < 1000, `matchday ${m.matchday} must be genuine`);
    assert.ok(!String(m.historySegment || "").includes("destination-past"));
  }

  assert.ok(
    player.age === ageAtPause || player.age === ageAtPause + 1,
    "age must tick at most once on season finalization"
  );
  assert.equal(player.seasons.length, seasonsBefore + 1);
  assert.ok(Number.isFinite(wageBefore));
});

test("same-league loan retains origin table context", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(11);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const p = makeSeniorInLeague("league:italy-serie-a", {
    name: "SameLeagueLoan",
    clubIndex: 0,
    careerId: "same-league-loan",
  });
  const borrower = league.clubs.find((c) => c.clubId !== p.club.clubId);
  const parentId = p.club.clubId;

  let paused = simulateChronologicalSeason({
    player: p,
    league,
    seasonIndex: 0,
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  if (paused.status !== "awaiting_decision" && paused.status !== "awaiting_scenario") {
    p.pendingDecision = {
      kind: "development-loan",
      headline: "test",
      lead: "test",
      choices: [{ id: "stay-compete", label: "Stay" }],
      cooldownKind: "development-loan",
      loanOffers: [],
    };
    paused = simulateChronologicalSeason({
      player: p,
      league,
      seasonIndex: 0,
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  assert.ok(
    paused.status === "awaiting_decision" || paused.status === "awaiting_scenario",
    `expected mid-season pause, got ${paused.status}`
  );

  const offer = {
    clubId: borrower.clubId,
    club: borrower.name,
    clubDisplay: borrower.displayName,
    dealType: "loan",
    isLoan: true,
    wage: 3500,
    loanFee: 50_000,
    loanTerms: {
      loanId: `loan:test:same-league:${borrower.clubId}`,
      loanFee: 50_000,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      parentClubId: parentId,
      borrowingClubId: borrower.clubId,
      startSeason: 0,
      endSeason: 1,
      startDate: paused.checkpoint.lastDate,
      endDate: "2027-06-30",
      status: "proposed",
      international: false,
    },
    effectiveDate: paused.checkpoint.lastDate,
    reviewDate: paused.checkpoint.lastDate,
    registration: resolveMoveRegistration({
      destinationLeagueId: league.leagueId,
      departureDate: paused.checkpoint.lastDate,
      originSeasonStartYear: 2026,
    }),
  };

  assert.equal(startLoan(p, offer).ok, true);
  assert.equal(p.playingClubId, borrower.clubId);
  assert.equal(p.employmentClubId, parentId);

  const done = resumeChronologicalSeason({
    player: p,
    league,
    seasonIndex: 0,
    checkpoint: paused.checkpoint,
  });
  assert.equal(done.status, "complete");
  assert.equal(done.activeLeague.leagueId, "league:italy-serie-a");
  assert.equal(done.table.length, league.clubs.length);
  assert.ok(done.playerRecord?.clubId === borrower.clubId);
  assert.ok(done.table.some((r) => r.clubId === parentId));
  const borrowerOwned = (done.playerMatches || []).filter(
    (m) =>
      m.playerClubId === borrower.clubId ||
      ((m.playerSide === "home" ? m.home?.clubId : m.away?.clubId) === borrower.clubId)
  );
  assert.ok(borrowerOwned.length > 0, "borrower must own post-loan player fixtures");
});

test("automatic acceptance path uses borrower league metadata", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026 }));
  const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
  if (!fixture.ok) {
    console.log("SKIP auto-accept — fixture unavailable:", fixture.reason);
    return;
  }
  const { player, checkpoint } = fixture;
  const parentId = player.employmentClubId;
  const offer = forceZwolleLoanOffer(player, checkpoint.lastDate || "2027-01-10");
  assert.equal(startLoan(player, offer).ok, true);
  player.pendingOffers = [];
  player.pendingDecision = null;

  const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    checkpoint,
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  assert.equal(seasonData.league.leagueId, "league:netherlands-eredivisie");
  assert.equal(seasonData.season.leagueId, "league:netherlands-eredivisie");
  assert.equal(seasonData.standings.table.length, 18);
  assert.equal(seasonData.standings.playerRecord?.clubId, "club:netherlands:pec-zwolle");
  assert.equal(player.employmentClubId, parentId);
});

test("snapshot restore keeps loan playing league after resume", () => {
  const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  const { player, checkpoint } = fixture;
  const offer = forceZwolleLoanOffer(player, checkpoint.lastDate || "2027-01-10");
  assert.equal(startLoan(player, offer).ok, true);
  const snap = roundTripCareerSnapshot({ player, world: getWorldState() });
  assert.equal(snap.player.activeLoan.status, "active");
  assert.equal(snap.player.playingClubId, "club:netherlands:pec-zwolle");
  setWorldState(snap.world);
  const restored = snap.player;
  restored.pendingOffers = [];
  restored.pendingDecision = null;
  const seasonData = simulateSeason(restored, LEAGUES, LEAGUE_LOOKUP, {
    checkpoint: restored.seasonCheckpoint || checkpoint,
    pauseForDecisions: false,
  });
  assert.equal(seasonData.league.leagueId, "league:netherlands-eredivisie");
  assert.equal(seasonData.standings.playerRecord?.clubId, "club:netherlands:pec-zwolle");
});

test("loan return restores parent playing context without rewriting history", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(7);
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = makeSeniorInLeague("league:italy-serie-a", {
    name: "ReturnHome",
    careerId: "return-home",
    clubIndex: 0,
  });
  const parentId = p.club.clubId;
  const { offers } = generateLoanOffers(p, {
    rng: createStreamRng("return-home", "loans"),
    maxOffers: 8,
  });
  if (!offers.length) {
    console.log("SKIP loan return — no offers");
    return;
  }
  const offer = offers[0];
  const shares = normalizeWageShares(
    offer.loanTerms.borrowerWageShare,
    offer.loanTerms.parentWageShare
  );
  assert.ok(Math.abs(shares.borrowerWageShare + shares.parentWageShare - 1) < 1e-9);
  assert.equal(startLoan(p, offer).ok, true);
  const seasonOnLoan = {
    seasonNumber: 1,
    club: p.club.name,
    clubId: p.playingClubId,
    employmentClubId: parentId,
    playingClubId: p.playingClubId,
    leagueId: p.club.leagueId,
  };
  p.seasons.push(seasonOnLoan);
  const returned = endLoan(p, "return");
  assert.equal(returned.ok, true);
  assert.equal(p.playingClubId, parentId);
  assert.equal(p.employmentClubId, parentId);
  assert.equal(p.club.clubId, parentId);
  assert.equal(p.seasons[0].playingClubId, seasonOnLoan.playingClubId);
  assert.equal(p.seasons[0].leagueId, seasonOnLoan.leagueId);
});

test("past destination matches seed standings but not player appearances", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026 }));
  const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  const { player, checkpoint } = fixture;
  const offer = forceZwolleLoanOffer(player, checkpoint.lastDate || "2027-01-10");
  assert.equal(startLoan(player, offer).ok, true);
  player.pendingOffers = [];
  player.pendingDecision = null;

  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const done = resumeChronologicalSeason({
    player,
    league,
    seasonIndex: 0,
    checkpoint,
  });
  assert.equal(done.status, "complete");
  assert.equal(done.activeLeague.leagueId, "league:netherlands-eredivisie");
  const pastMeta = player.destinationScheduleMeta?.pastSimulated || 0;
  assert.ok(pastMeta > 0, "destination past fixtures should be simulated for seeding");
  const playerApps = done.playerMatches || [];
  assert.ok(
    playerApps.every((m) => m.historySegment !== "destination-past"),
    "player appearances must exclude destination-past seed matches"
  );
  assert.ok(done.playerRecord?.played === 34);
});
