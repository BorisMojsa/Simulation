import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "./js/data/leagues.js";
import { createWorldState, setWorldState, getWorldState } from "./js/simulation/worldState.js";
import { createPlayerIdentity } from "./js/simulation/playerDevelopment.js";
import { ensurePlayingStints } from "./js/simulation/playingRegistration.js";
import { resetClubFinanceLedgers } from "./js/simulation/clubFinance.js";
import { applyDivisionMovement } from "./js/simulation/leaguePhase.js";
import { simulateSeason } from "./js/simulation/seasonSimulator.js";
import { startLoan } from "./js/simulation/loanMarket.js";
import { findSeniorClubById } from "./js/simulation/seniorClubs.js";
import { buildLiveLoanBrowserFixture } from "./js/simulation/liveLoanBrowserFixture.js";
import {
  resolveLeagueClubs,
  ensureFinalTableForEdition,
  commitForcedEditionResults,
  finalizeMembershipAfterSeason,
} from "./js/simulation/leagueMembership.js";
import { flattenRoundRobinFixtures, dateLeagueFixtures } from "./js/simulation/seasonCalendar.js?v=89";
import { simulateMatch } from "./js/simulation/matchEngine.js";
import { commitLeagueMatchResult } from "./js/simulation/leagueEditionAdapter.js";
import { rebuildTableFromMatches } from "./js/simulation/leagueTable.js";
import { createStreamRng } from "./js/simulation/rng.js";
import { controlledPairFinalize } from "./tests/helpers/membershipTestUtils.mjs";

const PL = LEAGUE_BY_ID.get("league:england-premier-league");
const CH = LEAGUE_BY_ID.get("league:england-championship");

function setup(league, name, seed = 42) {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, startYear: 2026 });
  setWorldState(world);
  const club = league.clubs.find((c) => c.name === name);
  assert.ok(club);
  const p = createPlayerIdentity({
    name: "Review Fix 03",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  Object.assign(p, {
    careerId: "review03-" + seed,
    startYear: 2026,
    rating: 76,
    potential: 88,
    attributes: {
      Speed: 76,
      Passing: 78,
      Shooting: 72,
      Defending: 74,
      Physicality: 76,
      Dribbling: 77,
    },
    playerModelVersion: 2,
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
    health: { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} },
    development: { latentBudget: 90, modelVersion: 1, migration: {} },
    club: { ...club, isAcademy: false, parentClub: null },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStartSeason: 0,
    contractYears: 4,
    contractEndSeason: 4,
    weeklyWage: 4000,
    seasons: [],
    pendingOffers: [],
    pendingDecision: null,
    seasonCheckpoint: null,
  });
  ensurePlayingStints(p, { asOfDate: "2026-07-01" });
  return { p, world, club };
}

const out = {
  reviewedCommit: "e9f1623d964f57789f61d2e00a97033e470b1fc3",
  note: "Re-run against working tree after R1–R4 fixes",
};

{
  const { world } = setup(CH, "Birmingham City", 401);
  const clubs = resolveLeagueClubs(PL, { world, seasonYear: 2026 });
  const fxs = dateLeagueFixtures(
    flattenRoundRobinFixtures(clubs, { idPrefix: "lg:" + PL.leagueId + ":2026" }),
    2026
  );
  const rng = createStreamRng("review03", "half-season");
  const played = [];
  for (const fx of fxs.filter((f) => f.matchday <= 19)) {
    const m = simulateMatch(fx.home, fx.away, {
      competition: "league",
      worldState: world,
      rng,
      competitionId: PL.leagueId,
      fixtureId: fx.fixtureId,
      date: fx.date,
    });
    Object.assign(m, {
      matchId: fx.fixtureId,
      editionId: "2026",
      seasonYear: 2026,
      matchday: fx.matchday,
      status: "played",
    });
    commitLeagueMatchResult(m, PL, 2026, world);
    played.push(m);
  }
  world.standings.set(PL.leagueId, rebuildTableFromMatches(clubs, played).table);
  const before = [...world.matches.values()].filter(
    (m) => (m.competitionId || m.leagueContextId) === PL.leagueId && String(m.editionId) === "2026"
  ).length;
  const r = ensureFinalTableForEdition({ league: PL, seasonYear: 2026, world });
  const after = [...world.matches.values()].filter(
    (m) => (m.competitionId || m.leagueContextId) === PL.leagueId && String(m.editionId) === "2026"
  ).length;
  out.partialTable = {
    returnedOk: r.ok,
    source: r.source,
    committedBefore: before,
    committedAfter: after,
    minPlayed: r.table ? Math.min(...r.table.map((x) => x.played)) : null,
    maxPlayed: r.table ? Math.max(...r.table.map((x) => x.played)) : null,
    expectedFinalPlayed: 38,
  };
  const stale = ensureFinalTableForEdition({ league: PL, seasonYear: 2027, world });
  out.staleTable = {
    returnedOk: stale.ok,
    source: stale.source,
    requestedSeason: 2027,
    fixturesInRequestedEdition: [...world.matches.values()].filter(
      (m) => String(m.editionId) === "2027" || m.seasonYear === 2027
    ).length,
  };
}

{
  const { p, world, club } = setup(PL, "Ipswich Town", 402);
  const borrower = findSeniorClubById(CH.clubs[0].clubId);
  const accepted = startLoan(p, {
    isLoan: true,
    wage: 4000,
    expectedRole: "starter",
    clubId: borrower.clubId,
    club: borrower,
    loanTerms: {
      loanId: "review03-moving-parent",
      borrowingClubId: borrower.clubId,
      parentClubId: club.clubId,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      loanFee: 0,
      endSeason: 1,
      startDate: "2026-07-15",
    },
  });
  assert.equal(accepted.ok, true, String(accepted.reason));
  for (const id of world.leagueMemberships.get(PL.leagueId)) {
    const pr = world.clubs.get(id);
    const n = id === club.clubId ? 40 : 90;
    for (const k of ["overall", "attack", "midfield", "defence", "goalkeeper"]) pr[k] = n;
  }
  const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(done.season, "must finish borrower season");
  let parentMoved = world.leagueMemberships.get(CH.leagueId).includes(club.clubId);
  if (!parentMoved) {
    const plIds = world.leagueEditionRosters.get(`${PL.leagueId}::2026`).clubIds;
    const chIds = world.leagueEditionRosters.get(`${CH.leagueId}::2026`).clubIds;
    const orderedPl = [...plIds.filter((id) => id !== club.clubId), club.clubId];
    commitForcedEditionResults(PL, 2026, orderedPl, world);
    commitForcedEditionResults(CH, 2026, chIds, world);
    finalizeMembershipAfterSeason({
      completedLeague: PL,
      completedSeasonYear: 2026,
      world,
      completedClubId: club.clubId,
    });
    parentMoved = world.leagueMemberships.get(CH.leagueId).includes(club.clubId);
  }
  const beforeReturn = {
    parentWorldLeague: world.clubs.get(club.clubId)?.leagueId,
    parentSnapshotLeague: p.parentClubSnapshot?.leagueId,
    playerClub: p.club?.clubId,
    completedSeasons: p.seasons.length,
  };
  let nextError = null;
  let nextStatus = null;
  try {
    const next = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    nextStatus = next.season ? "complete" : "other";
  } catch (e) {
    nextError = e.message;
  }
  out.movedParentLoanReturn = {
    loanAccepted: accepted.ok,
    parentMoved,
    beforeReturn,
    afterReturnLeague: p.club?.leagueId,
    parentWorldLeague: world.clubs.get(club.clubId)?.leagueId,
    nextStatus,
    nextError,
  };
}

{
  const f = buildLiveLoanBrowserFixture({ seed: 42 });
  assert.ok(f.ok, f.reason);
  const offer = f.offers[0];
  const accepted = startLoan(f.player, offer);
  assert.equal(accepted.ok, true, String(accepted.reason));
  f.player.pendingOffers = [];
  f.player.pendingDecision = null;
  const done = simulateSeason(f.player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  const world = getWorldState();
  out.crossCountrySourcePair = {
    sourceLeague: "league:italy-serie-a",
    destinationLeague: f.player.club?.leagueId,
    completed: !!done.season,
    sourceCommittedMatches: [...world.matches.values()].filter(
      (m) => m.competitionId === "league:italy-serie-a"
    ).length,
    transitions: [...world.membershipTransitions.keys()],
    recordedTransition: done.season?.membershipTransition,
    seasonSegmentLeagueIds: done.season?.leagueMatchSegments?.map(
      (x) => x.leagueId || x.leagueContextId
    ),
  };
}

{
  const { p, world, club } = setup(CH, "Birmingham City", 403);
  const keys = [];
  for (let year = 2026; year <= 2028; year++) {
    const id = world.clubs.get(club.clubId).leagueId;
    const league = LEAGUE_BY_ID.get(id);
    p.club = { ...p.club, leagueId: id, league: league.name };
    p.playingClubId = club.clubId;
    p.seasons = Array.from({ length: year - 2026 }, (_, i) => ({ seasonNumber: i + 1 }));
    // Position-only applyDivisionMovement must not fabricate; use controlled fixtures.
    const posOnly = applyDivisionMovement(p, { position: id === CH.leagueId ? 2 : 10 }, league, LEAGUES);
    void posOnly;
    const result = controlledPairFinalize({
      player: p,
      league,
      position: id === CH.leagueId ? 2 : 10,
      world,
      seasonYear: year,
    });
    assert.equal(result.ok, true, String(result.reason));
    keys.push(`england::${year}`);
  }
  out.threeBoundaryTestCoverage = {
    claimedIterations: 3,
    actualTransitionKeys: [...world.membershipTransitions.keys()],
    expectedKeys: keys,
  };
}

console.log(JSON.stringify(out, null, 2));
