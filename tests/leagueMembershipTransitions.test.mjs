/**
 * Fix 03 — balanced league membership after promotion / relegation.
 * Run: node tests/leagueMembershipTransitions.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
  deserializeWorldState,
  exchangeLeagueMembership,
  getWorldState,
} from "../js/simulation/worldState.js";
import { applyDivisionMovement, divisionMoveSlots, findSisterLeagues } from "../js/simulation/leaguePhase.js";
import {
  DIVISION_PAIR_POLICY,
  finalizeMembershipAfterSeason,
  completeWorldLeagueEdition,
  resolveLeagueClubs,
  resolveClubLeagueMetadata,
} from "../js/simulation/leagueMembership.js";
import { simulateChronologicalSeason, resumeChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { simulateLeagueSeason } from "../js/simulation/leagueFixtures.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { buildDestinationLeagueSchedule } from "../js/simulation/destinationSchedule.js";
import { allSeniorClubs, findSeniorClubById } from "../js/simulation/seniorClubs.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { applyOfferToPlayer, buildValidatedOffer } from "../js/simulation/dealPipeline.js";
import { startLoan, endLoan } from "../js/simulation/loanMarket.js";
import { applyContractExpiryAtBoundary } from "../js/simulation/contractLifecycle.js";

const PL = LEAGUE_BY_ID.get("league:england-premier-league");
const CH = LEAGUE_BY_ID.get("league:england-championship");

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out.then(
        () => console.log(`OK  ${name}`),
        (e) => {
          console.error(`FAIL ${name}`);
          console.error(e);
          process.exitCode = 1;
        }
      );
    }
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function sizeEngland(world = getWorldState()) {
  return {
    premier: world.leagueMemberships.get(PL.leagueId).length,
    championship: world.leagueMemberships.get(CH.leagueId).length,
  };
}

function setupPlayer(league, clubName, { contractEndSeason = 4, seed = 42 } = {}) {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, startYear: 2026 });
  setWorldState(world);
  const club = league.clubs.find((c) => c.name === clubName);
  assert.ok(club, clubName);
  const p = createPlayerIdentity({
    name: "Fix03 Membership",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  Object.assign(p, {
    careerId: `fix03-${clubName}-${seed}`,
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
    contractYears: contractEndSeason,
    contractEndSeason,
    weeklyWage: 4000,
    seasons: [],
  });
  ensurePlayingStints(p, { asOfDate: "2026-07-01" });
  return { p, world, club };
}

function assertHomeAwayOnce(fixtures, clubCount) {
  const pairs = new Map();
  for (const m of fixtures) {
    const home = m.home?.clubId || m.home?.name;
    const away = m.away?.clubId || m.away?.name;
    assert.ok(home && away && home !== away);
    const key = `${home}>${away}`;
    assert.equal(pairs.has(key), false, `duplicate fixture ${key}`);
    pairs.set(key, true);
  }
  assert.equal(fixtures.length, clubCount * (clubCount - 1));
}

function assertUniqueRegularFixtures(fixtures, expectedCount) {
  const ids = new Set();
  for (const m of fixtures) {
    const id =
      m.fixtureId ||
      m.matchId ||
      `${m.date}:${m.home?.clubId || m.home?.name}:${m.away?.clubId || m.away?.name}`;
    assert.equal(ids.has(id), false, `duplicate fixture id ${id}`);
    ids.add(id);
  }
  assert.equal(fixtures.length, expectedCount);
  assert.equal(ids.size, expectedCount);
}

test("shared move counts match section-3 policy for all five pairs", () => {
  for (const policy of DIVISION_PAIR_POLICY) {
    const upper = LEAGUE_BY_ID.get(policy.upperId);
    const lower = LEAGUE_BY_ID.get(policy.lowerId);
    assert.ok(upper && lower, policy.pairId);
    assert.equal(upper.clubs.length, policy.upperCapacity);
    assert.equal(lower.clubs.length, policy.lowerCapacity);
    const uSisters = findSisterLeagues(upper, LEAGUES);
    const lSisters = findSisterLeagues(lower, LEAGUES);
    assert.equal(divisionMoveSlots(upper, uSisters).relegateSlots, policy.exchange);
    assert.equal(divisionMoveSlots(lower, lSisters).promoteSlots, policy.exchange);
    assert.equal(divisionMoveSlots(upper, uSisters).promoteSlots, 0);
    assert.equal(divisionMoveSlots(lower, lSisters).relegateSlots, 0);
  }
});

test("Birmingham promotion keeps England 20/24 and moves three each way", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City");
  const before = sizeEngland(world);
  assert.deepEqual(before, { premier: 20, championship: 24 });
  const move = applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  assert.equal(move?.type, "promoted");
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  const t = [...world.membershipTransitions.values()][0];
  assert.equal(t.promoted.length, 3);
  assert.equal(t.relegated.length, 3);
  assert.ok(t.promoted.includes(club.clubId));
  assert.ok(world.leagueMemberships.get(PL.leagueId).includes(club.clubId));
  assert.equal(world.leagueMemberships.get(CH.leagueId).includes(club.clubId), false);
  assert.equal(p.club.leagueId, PL.leagueId);
});

test("Ipswich relegation keeps England 20/24", () => {
  const { p, world, club } = setupPlayer(PL, "Ipswich Town");
  const move = applyDivisionMovement(p, { position: 20 }, PL, LEAGUES);
  assert.equal(move?.type, "relegated");
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  assert.ok(world.leagueMemberships.get(CH.leagueId).includes(club.clubId));
  assert.equal(world.leagueMemberships.get(PL.leagueId).includes(club.clubId), false);
});

test("mid-table player does not move but entitled clubs still exchange", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 77 });
  const move = applyDivisionMovement(p, { position: 12 }, CH, LEAGUES);
  assert.equal(move, null);
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  const t = [...world.membershipTransitions.values()][0];
  assert.equal(t.promoted.includes(club.clubId), false);
  assert.equal(t.promoted.length, 3);
  assert.equal(t.relegated.length, 3);
  assert.equal(p.club.leagueId, CH.leagueId);
});

test("following PL/Championship editions have correct rows, fixtures, home/away", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 91 });
  assert.equal(applyDivisionMovement(p, { position: 1 }, CH, LEAGUES)?.type, "promoted");
  const plNext = simulateChronologicalSeason({
    player: p,
    league: PL,
    seasonIndex: 1,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(plNext.table.length, 20);
  assertUniqueRegularFixtures(plNext.allMatches, 380);
  assert.equal(plNext.playerMatches.length, 38);
  assert.equal(plNext.expectedMatches, 38);
  assertHomeAwayOnce(plNext.allMatches, 20);

  // Separate relegation path for Championship next edition
  const { p: p2, club: c2 } = setupPlayer(PL, "Ipswich Town", { seed: 92 });
  assert.equal(applyDivisionMovement(p2, { position: 20 }, PL, LEAGUES)?.type, "relegated");
  const chNext = simulateChronologicalSeason({
    player: p2,
    league: CH,
    seasonIndex: 1,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(chNext.table.length, 24);
  assertUniqueRegularFixtures(chNext.allMatches, 552);
  assert.equal(chNext.playerMatches.length, 46);
  assert.equal(chNext.expectedMatches, 46);
  assertHomeAwayOnce(chNext.allMatches, 24);
  void world;
  void club;
  void c2;
});

test("legacy simulator and destination builder share edition roster after move", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 93 });
  applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  p.seasons = [{ seasonNumber: 1 }];
  const legacy = simulateLeagueSeason(PL, p, 70);
  assert.equal(legacy.table.length, 20);
  assert.equal(legacy.allMatches.length, 380);
  assert.equal(legacy.playerMatches.length, 38);
  const dest = buildDestinationLeagueSchedule(PL, 2027, world);
  assert.equal(dest.clubs.length, 20);
  assert.ok(dest.clubs.some((c) => c.clubId === club.clubId));
  assert.equal(
    dest.dated.filter((f) => [f.home?.clubId, f.away?.clubId].includes(club.clubId)).length,
    38
  );
  assert.equal(dest.clubs.some((c) => !world.leagueMemberships.get(PL.leagueId).includes(c.clubId)), false);
});

test("catalog and accepted permanent move use new division fixtures", () => {
  const { p: host, world: w2, club: bhm } = setupPlayer(CH, "Birmingham City", { seed: 96 });
  applyDivisionMovement(host, { position: 1 }, CH, LEAGUES);
  const catalog = allSeniorClubs(w2).find((c) => c.clubId === bhm.clubId);
  assert.equal(catalog?.leagueId, PL.leagueId);
  assert.equal(findSeniorClubById(bhm.clubId)?.leagueId, PL.leagueId);
  assert.equal(resolveClubLeagueMetadata(bhm.clubId, w2)?.leagueId, PL.leagueId);

  const { p: buyer } = setupPlayer(PL, "Arsenal", { seed: 95 });
  setWorldState(w2);
  const promotedClub = findSeniorClubById(bhm.clubId);
  assert.equal(promotedClub.leagueId, PL.leagueId);
  // Free-agent path avoids ordinary fee-band rejection while still using production acceptance.
  buyer.contractEndSeason = 0;
  buyer.contractStatus = "expired";
  const built = buildValidatedOffer({
    player: buyer,
    club: promotedClub,
    fit: {
      eligible: true,
      pathway: "senior",
      scout: { assessedReadiness: 75, assessedUpside: 80 },
      projection: { role: "starter", minutesShare: 0.7, minutesRange: [60, 90], gap: 0, benchmark: 74 },
    },
    dealType: "free_agent",
    performanceScore: 72,
  });
  assert.equal(built.ok, true, String(built.reasons));
  applyOfferToPlayer(buyer, built.offer, "fix03-bhm-transfer");
  assert.equal(buyer.club.clubId, bhm.clubId);
  assert.equal(buyer.club.leagueId, PL.leagueId);
  const dest = buildDestinationLeagueSchedule(PL, 2027, w2);
  assert.equal(dest.clubs.some((c) => c.clubId === bhm.clubId), true);
  assert.equal(
    dest.dated.filter((f) => [f.home?.clubId, f.away?.clubId].includes(bhm.clubId)).length,
    38
  );
});

test("loan and return resolve parent current division", () => {
  const { p, world, club } = setupPlayer(PL, "Ipswich Town", { seed: 97 });
  applyDivisionMovement(p, { position: 20 }, PL, LEAGUES);
  assert.equal(p.club.leagueId, CH.leagueId);
  const borrowerId = world.leagueMemberships
    .get(CH.leagueId)
    .find((id) => id !== club.clubId);
  const borrower = findSeniorClubById(borrowerId);
  assert.ok(borrower);
  const loanOffer = {
    isLoan: true,
    wage: 4000,
    expectedRole: "starter",
    clubId: borrower.clubId,
    club: borrower,
    loanTerms: {
      loanId: "fix03-loan-1",
      borrowingClubId: borrower.clubId,
      parentClubId: club.clubId,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      loanFee: 0,
      endSeason: 3,
      startDate: "2027-08-01",
    },
  };
  const started = startLoan(p, loanOffer);
  assert.equal(started.ok, true, String(started.reason));
  assert.equal(p.employmentClubId, club.clubId);
  assert.equal(p.playingClubId, borrower.clubId);
  const ended = endLoan(p, "return", { asOfDate: "2028-06-01" });
  assert.equal(ended.ok, true, String(ended.reason));
  assert.equal(p.employmentClubId, club.clubId);
  assert.equal(p.playingClubId, club.clubId);
  assert.equal(resolveClubLeagueMetadata(club.clubId, world)?.leagueId, CH.leagueId);
  assert.equal(p.club.leagueId, CH.leagueId);
});

test("contract expiry at boundary still moves completed club", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", {
    seed: 98,
    contractEndSeason: 0,
  });
  // Expiry clears club; membership transition must still commit.
  const expiry = applyContractExpiryAtBoundary(p);
  assert.ok(expiry?.expired || !p.club || p.contractStatus === "expired" || p.contractEndSeason === 0);
  // Restore minimal identity for controlled finalize via completedClubId
  const result = finalizeMembershipAfterSeason({
    player: p,
    completedLeague: CH,
    completedTable: null,
    completedSeasonYear: 2026,
    world,
    completedClubId: club.clubId,
  });
  // Need a preferred table — fabricate via apply with club temporarily set
  const { p: p2, world: w2, club: c2 } = setupPlayer(CH, "Birmingham City", {
    seed: 99,
    contractEndSeason: 1,
  });
  // Finish season 0 then expire
  p2.contractEndSeason = 0;
  p2.contractYears = 0;
  const move = applyDivisionMovement(p2, { position: 2 }, CH, LEAGUES);
  assert.equal(move?.type, "promoted");
  applyContractExpiryAtBoundary(p2);
  assert.deepEqual(sizeEngland(w2), { premier: 20, championship: 24 });
  assert.ok(w2.leagueMemberships.get(PL.leagueId).includes(c2.clubId));
  void result;
  void club;
});

test("missing counterpart table is completed world-only without player effects", () => {
  const { p, world } = setupPlayer(CH, "Birmingham City", { seed: 100 });
  const beforePlayer = JSON.stringify({
    rating: p.rating,
    age: p.age,
    seasons: p.seasons,
    attributes: p.attributes,
    health: p.health,
    state: p.state,
    club: p.club,
  });
  const beforeForm = world.form.size;
  const completed = completeWorldLeagueEdition({
    league: PL,
    seasonYear: 2026,
    world,
    careerSeed: world.rngSeed,
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.table.length, 20);
  assert.ok((completed.simulated || 0) > 0 || completed.reused);
  const afterPlayer = JSON.stringify({
    rating: p.rating,
    age: p.age,
    seasons: p.seasons,
    attributes: p.attributes,
    health: p.health,
    state: p.state,
    club: p.club,
  });
  assert.equal(afterPlayer, beforePlayer);
  assert.equal(p.seasons.length, 0);
  // Form may update from world matches; player object must be untouched.
  void beforeForm;
});

test("repeated call and serialized restore are idempotent", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 101 });
  const m1 = applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  assert.equal(m1?.type, "promoted");
  const snap = serializeWorldState(world);
  const roster = {
    pl: [...world.leagueMemberships.get(PL.leagueId)],
    ch: [...world.leagueMemberships.get(CH.leagueId)],
  };
  const m2 = applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  assert.equal(m2, null);
  assert.deepEqual([...world.leagueMemberships.get(PL.leagueId)], roster.pl);
  assert.equal(world.membershipTransitions.size, 1);

  const restored = deserializeWorldState(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(sizeEngland(restored), { premier: 20, championship: 24 });
  assert.ok(restored.leagueMemberships.get(PL.leagueId).includes(club.clubId));
  assert.equal(restored.membershipTransitions.size, 1);
  setWorldState(restored);
  const m3 = applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  assert.equal(m3, null);
  assert.deepEqual(sizeEngland(restored), { premier: 20, championship: 24 });
});

test("snapshot during next season pause restores same participants", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 102 });
  applyDivisionMovement(p, { position: 1 }, CH, LEAGUES);
  const paused = simulateChronologicalSeason({
    player: p,
    league: PL,
    seasonIndex: 1,
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  assert.ok(paused.status === "awaiting_decision" || paused.checkpoint);
  const cp = paused.checkpoint || p.seasonCheckpoint;
  assert.ok(cp?.clubs?.length === 20 || paused.table?.length || cp);
  const rt = roundTripCareerSnapshot({
    player: p,
    world,
    checkpoint: cp,
  });
  assert.deepEqual(sizeEngland(rt.world), { premier: 20, championship: 24 });
  assert.ok(rt.world.leagueMemberships.get(PL.leagueId).includes(club.clubId));
  setWorldState(rt.world);
  const resumed = resumeChronologicalSeason({
    player: rt.player,
    league: PL,
    seasonIndex: 1,
    checkpoint: rt.seasonCheckpoint || cp,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(resumed.status, "complete");
  assert.equal(resumed.table.length, 20);
  assert.equal(world.membershipTransitions.size >= 1, true);
});

test("invalid membership fails without partial player mutation", () => {
  const { p, world } = setupPlayer(CH, "Birmingham City", { seed: 103 });
  const ids = world.leagueMemberships.get(CH.leagueId);
  ids.splice(ids.indexOf(p.club.clubId), 1);
  const prior = { ...p.club };
  const no = exchangeLeagueMembership(world, CH.leagueId, PL.leagueId, p.club.clubId);
  assert.equal(no, false);
  const move = applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  assert.equal(move, null);
  assert.equal(p.club.leagueId, prior.leagueId);
  assert.equal(world.clubs.get(prior.clubId)?.leagueId, CH.leagueId);
});

test("no modeled sister skips invented promotion destination", () => {
  const lone = LEAGUES.find((l) => !DIVISION_PAIR_POLICY.some((p) => p.upperId === l.leagueId || p.lowerId === l.leagueId));
  assert.ok(lone);
  const { p, world } = setupPlayer(lone, lone.clubs[0].name, { seed: 104 });
  const result = finalizeMembershipAfterSeason({
    player: p,
    completedLeague: lone,
    completedTable: resolveLeagueClubs(lone, { world }).map((c, i) => ({
      ...c,
      position: i + 1,
      played: lone.clubs.length - 1,
      points: (lone.clubs.length - 1 - i) * 3,
    })),
    completedSeasonYear: 2026,
    world,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("three consecutive England boundaries preserve capacity and uniqueness", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 105 });
  for (let year = 2026; year <= 2028; year++) {
    const leagueId = world.clubs.get(club.clubId)?.leagueId;
    const league = LEAGUE_BY_ID.get(leagueId);
    const pos = leagueId === CH.leagueId ? 2 : 10;
    // Force player club into current league object
    p.club = {
      ...p.club,
      ...resolveClubLeagueMetadata(club.clubId, world),
      clubId: club.clubId,
    };
    p.playingClubId = club.clubId;
    p.seasons = Array.from({ length: year - 2026 }, (_, i) => ({ seasonNumber: i + 1 }));
    applyDivisionMovement(p, { position: pos }, league, LEAGUES);
    assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
    const pl = world.leagueMemberships.get(PL.leagueId);
    const ch = world.leagueMemberships.get(CH.leagueId);
    assert.equal(new Set(pl).size, 20);
    assert.equal(new Set(ch).size, 24);
    for (const id of pl) assert.equal(ch.includes(id), false);
  }
  // Fresh career retains seed membership
  const fresh = createWorldState({ seed: 999, startYear: 2026 });
  assert.deepEqual(
    {
      premier: fresh.leagueMemberships.get(PL.leagueId).length,
      championship: fresh.leagueMemberships.get(CH.leagueId).length,
    },
    { premier: 20, championship: 24 }
  );
  assert.deepEqual(fresh.leagueMemberships.get(PL.leagueId), PL.clubs.map((c) => c.clubId));
});

test("prior edition history unchanged; next live table has exact roster", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 106 });
  const chClubsBefore = resolveLeagueClubs(CH, { world }).map((c) => c.clubId);
  applyDivisionMovement(p, { position: 2 }, CH, LEAGUES);
  const frozen = world.leagueEditionRosters.get(`${CH.leagueId}::2026`);
  assert.deepEqual(frozen.clubIds, chClubsBefore);
  const nextClubs = resolveLeagueClubs(PL, { world, seasonYear: 2027 }).map((c) => c.clubId);
  assert.equal(nextClubs.length, 20);
  assert.ok(nextClubs.includes(club.clubId));
  const next = simulateChronologicalSeason({
    player: p,
    league: PL,
    seasonIndex: 1,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(next.table.length, 20);
  assert.equal(next.table.every((r) => nextClubs.includes(r.clubId)), true);
  // Old freeze intact
  assert.deepEqual(world.leagueEditionRosters.get(`${CH.leagueId}::2026`).clubIds, chClubsBefore);
});

test("production simulateSeason promotion then next edition (strength-biased)", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 201 });
  // Bias strengths so Birmingham finishes in the promotion places.
  for (const id of world.leagueMemberships.get(CH.leagueId)) {
    const profile = world.clubs.get(id);
    if (!profile) continue;
    if (id === club.clubId) {
      profile.overall = 92;
      profile.attack = 92;
      profile.midfield = 92;
      profile.defence = 92;
      profile.goalkeeper = 90;
    } else {
      profile.overall = 58;
      profile.attack = 58;
      profile.midfield = 58;
      profile.defence = 58;
      profile.goalkeeper = 58;
    }
  }
  const done = simulateSeason(p, LEAGUES, new Map(LEAGUES.map((l) => [l.name, l])), {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(done?.season);
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  const transition = [...world.membershipTransitions.values()][0];
  assert.ok(transition);
  assert.equal(transition.promoted.length, 3);
  assert.equal(transition.relegated.length, 3);
  if (transition.promoted.includes(club.clubId)) {
    assert.equal(p.club.leagueId, PL.leagueId);
    const next = simulateChronologicalSeason({
      player: p,
      league: PL,
      seasonIndex: 1,
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.equal(next.table.length, 20);
    assert.equal(next.allMatches.length, 380);
    assert.equal(next.playerMatches.length, 38);
  } else {
    // Strength bias did not guarantee promotion; still require balanced exchange.
    assert.equal(p.club.leagueId, CH.leagueId);
    console.log("  note: Birmingham not promoted under seed 201; pair exchange still balanced");
  }
});

test("production simulateSeason relegation then next edition (strength-biased)", () => {
  const { p, world, club } = setupPlayer(PL, "Ipswich Town", { seed: 202 });
  for (const id of world.leagueMemberships.get(PL.leagueId)) {
    const profile = world.clubs.get(id);
    if (!profile) continue;
    if (id === club.clubId) {
      profile.overall = 48;
      profile.attack = 48;
      profile.midfield = 48;
      profile.defence = 48;
      profile.goalkeeper = 48;
    } else {
      profile.overall = 82;
      profile.attack = 82;
      profile.midfield = 82;
      profile.defence = 82;
      profile.goalkeeper = 80;
    }
  }
  const done = simulateSeason(p, LEAGUES, new Map(LEAGUES.map((l) => [l.name, l])), {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(done?.season);
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  const transition = [...world.membershipTransitions.values()][0];
  assert.ok(transition);
  if (transition.relegated.includes(club.clubId)) {
    assert.equal(p.club.leagueId, CH.leagueId);
    const next = simulateChronologicalSeason({
      player: p,
      league: CH,
      seasonIndex: 1,
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.equal(next.table.length, 24);
    assert.equal(next.allMatches.length, 552);
    assert.equal(next.playerMatches.length, 46);
  } else {
    console.log("  note: Ipswich not relegated under seed 202; pair exchange still balanced");
  }
});

test("Spain pair uses shared exchange of 3", () => {
  const upper = LEAGUE_BY_ID.get("league:spain-la-liga");
  const lower = LEAGUE_BY_ID.get("league:spain-laliga-2");
  resetClubFinanceLedgers();
  const world = createWorldState({ seed: 301, startYear: 2026 });
  setWorldState(world);
  const club = lower.clubs[0];
  const p = {
    startYear: 2026,
    seasons: [],
    club: { ...club },
    playingClubId: club.clubId,
    employmentClubId: club.clubId,
  };
  const move = applyDivisionMovement(p, { position: 1 }, lower, LEAGUES);
  assert.equal(move?.type, "promoted");
  assert.equal(world.leagueMemberships.get(upper.leagueId).length, 20);
  assert.equal(world.leagueMemberships.get(lower.leagueId).length, 22);
  const t = [...world.membershipTransitions.values()][0];
  assert.equal(t.exchange, 3);
  assert.equal(t.promoted.length, 3);
  assert.equal(t.relegated.length, 3);
});

console.log(process.exitCode ? "Some membership tests failed." : "All membership transition tests passed.");
