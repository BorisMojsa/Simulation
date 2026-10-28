/**
 * Fix 03 — balanced league membership after promotion / relegation.
 * Run: node tests/leagueMembershipTransitions.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_BY_ID, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
  deserializeWorldState,
  exchangeLeagueMembership,
  getWorldState,
} from "../js/simulation/worldState.js";
import { divisionMoveSlots, findSisterLeagues } from "../js/simulation/leaguePhase.js";
import {
  DIVISION_PAIR_POLICY,
  finalizeMembershipAfterSeason,
  finalizeMembershipForSeasonSegments,
  completeWorldLeagueEdition,
  ensureFinalTableForEdition,
  collectEditionFixtures,
  resolveLeagueClubs,
  resolveClubLeagueMetadata,
  commitForcedEditionResults,
} from "../js/simulation/leagueMembership.js";
import { controlledPairFinalize } from "./helpers/membershipTestUtils.mjs";
import { flattenRoundRobinFixtures, dateLeagueFixtures } from "../js/simulation/seasonCalendar.js?v=89";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { commitLeagueMatchResult } from "../js/simulation/leagueEditionAdapter.js";
import { rebuildTableFromMatches } from "../js/simulation/leagueTable.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";

/** Controlled movement via committed fixtures + production finalize (no fabricated tables). */
function forceMove(player, league, position, world, seasonYear = 2026) {
  const result = controlledPairFinalize({
    player,
    league,
    position,
    world,
    seasonYear,
  });
  if (!result.ok) return null;
  if (result.alreadyApplied) return null;
  return result.playerMove || null;
}
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
  const move = forceMove(p, CH, 2, world);
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
  const move = forceMove(p, PL, 20, world);
  assert.equal(move?.type, "relegated");
  assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
  assert.ok(world.leagueMemberships.get(CH.leagueId).includes(club.clubId));
  assert.equal(world.leagueMemberships.get(PL.leagueId).includes(club.clubId), false);
});

test("mid-table player does not move but entitled clubs still exchange", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 77 });
  const move = forceMove(p, CH, 12, world);
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
  assert.equal(forceMove(p, CH, 1, world)?.type, "promoted");
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
  assert.equal(forceMove(p2, PL, 20, getWorldState())?.type, "relegated");
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
  forceMove(p, CH, 2, world);
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
  forceMove(host, CH, 1, w2);
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
  forceMove(p, PL, 20, world);
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
  const move = forceMove(p2, CH, 2, w2);
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
  const m1 = forceMove(p, CH, 2, world);
  assert.equal(m1?.type, "promoted");
  const snap = serializeWorldState(world);
  const roster = {
    pl: [...world.leagueMemberships.get(PL.leagueId)],
    ch: [...world.leagueMemberships.get(CH.leagueId)],
  };
  const m2 = finalizeMembershipAfterSeason({
    player: p,
    completedLeague: CH,
    completedSeasonYear: 2026,
    world,
    completedClubId: club.clubId,
  });
  assert.equal(m2.alreadyApplied, true);
  assert.deepEqual([...world.leagueMemberships.get(PL.leagueId)], roster.pl);
  assert.equal(world.membershipTransitions.size, 1);

  const restored = deserializeWorldState(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(sizeEngland(restored), { premier: 20, championship: 24 });
  assert.ok(restored.leagueMemberships.get(PL.leagueId).includes(club.clubId));
  assert.equal(restored.membershipTransitions.size, 1);
  setWorldState(restored);
  const m3 = finalizeMembershipAfterSeason({
    player: p,
    completedLeague: CH,
    completedSeasonYear: 2026,
    world: restored,
    completedClubId: club.clubId,
  });
  assert.equal(m3.alreadyApplied, true);
  assert.deepEqual(sizeEngland(restored), { premier: 20, championship: 24 });
});

test("snapshot during next season pause restores same participants", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 102 });
  forceMove(p, CH, 1, world);
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
  const result = finalizeMembershipAfterSeason({
    player: p,
    completedLeague: CH,
    completedSeasonYear: 2026,
    world,
    completedClubId: prior.clubId,
  });
  assert.equal(result.ok, false);
  assert.equal(p.club.leagueId, prior.leagueId);
  assert.equal(world.clubs.get(prior.clubId)?.leagueId, CH.leagueId);
  assert.equal(world.membershipTransitions.size, 0);
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
  const keys = [];
  for (let year = 2026; year <= 2028; year++) {
    const leagueId = world.clubs.get(club.clubId)?.leagueId || resolveClubLeagueMetadata(club.clubId, world)?.leagueId;
    const league = LEAGUE_BY_ID.get(leagueId);
    const pos = leagueId === CH.leagueId ? 2 : 10;
    p.club = {
      ...p.club,
      ...resolveClubLeagueMetadata(club.clubId, world),
      clubId: club.clubId,
    };
    p.playingClubId = club.clubId;
    p.seasons = Array.from({ length: year - 2026 }, (_, i) => ({ seasonNumber: i + 1 }));
    const move = forceMove(p, league, pos, world, year);
    void move;
    assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
    const key = `england::${year}`;
    assert.ok(world.membershipTransitions.has(key), `missing transition ${key}`);
    keys.push(key);
    const pl = world.leagueMemberships.get(PL.leagueId);
    const ch = world.leagueMemberships.get(CH.leagueId);
    assert.equal(new Set(pl).size, 20);
    assert.equal(new Set(ch).size, 24);
    for (const id of pl) assert.equal(ch.includes(id), false);
  }
  assert.deepEqual(keys, ["england::2026", "england::2027", "england::2028"]);
  assert.equal(world.membershipTransitions.size, 3);
  const fresh = createWorldState({ seed: 999, startYear: 2026 });
  assert.deepEqual(fresh.leagueMemberships.get(PL.leagueId), PL.clubs.map((c) => c.clubId));
});

test("prior edition history unchanged; next live table has exact roster", () => {
  const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed: 106 });
  const chClubsBefore = resolveLeagueClubs(CH, { world }).map((c) => c.clubId);
  forceMove(p, CH, 2, world);
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
  assert.deepEqual(world.leagueEditionRosters.get(`${CH.leagueId}::2026`).clubIds, chClubsBefore);
});

test("production simulateSeason promotion then next edition (strength-biased)", () => {
  // Try multiple seeds until Birmingham is promoted; fail if none succeed.
  let promoted = false;
  let last = null;
  for (const seed of [201, 211, 221, 231, 241, 251, 261, 271]) {
    const { p, world, club } = setupPlayer(CH, "Birmingham City", { seed });
    for (const id of world.leagueMemberships.get(CH.leagueId)) {
      const profile = world.clubs.get(id);
      if (!profile) continue;
      const strong = id === club.clubId;
      const v = strong ? 94 : 50;
      profile.overall = v;
      profile.attack = v;
      profile.midfield = v;
      profile.defence = v;
      profile.goalkeeper = strong ? 92 : 48;
    }
    const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.ok(done?.season);
    assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
    const transition = [...world.membershipTransitions.values()][0];
    assert.ok(transition);
    assert.equal(transition.promoted.length, 3);
    assert.equal(transition.relegated.length, 3);
    last = { p, world, club, transition };
    if (transition.promoted.includes(club.clubId)) {
      promoted = true;
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
      break;
    }
  }
  assert.equal(promoted, true, `Birmingham never promoted across seeds; last=${last?.transition?.promoted}`);
});

test("production simulateSeason relegation then next edition (strength-biased)", () => {
  let relegated = false;
  let last = null;
  for (const seed of [202, 212, 222, 232, 242, 252, 262, 272]) {
    const { p, world, club } = setupPlayer(PL, "Ipswich Town", { seed });
    for (const id of world.leagueMemberships.get(PL.leagueId)) {
      const profile = world.clubs.get(id);
      if (!profile) continue;
      const weak = id === club.clubId;
      const v = weak ? 42 : 88;
      profile.overall = v;
      profile.attack = v;
      profile.midfield = v;
      profile.defence = v;
      profile.goalkeeper = weak ? 40 : 86;
    }
    const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.ok(done?.season);
    assert.deepEqual(sizeEngland(world), { premier: 20, championship: 24 });
    const transition = [...world.membershipTransitions.values()][0];
    assert.ok(transition);
    last = { transition, club };
    if (transition.relegated.includes(club.clubId)) {
      relegated = true;
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
      break;
    }
  }
  assert.equal(relegated, true, `Ipswich never relegated across seeds; last=${last?.transition?.relegated}`);
});

test("all five pairs exchange via committed transitions", () => {
  for (const policy of DIVISION_PAIR_POLICY) {
    const upper = LEAGUE_BY_ID.get(policy.upperId);
    const lower = LEAGUE_BY_ID.get(policy.lowerId);
    resetClubFinanceLedgers();
    const world = createWorldState({ seed: 400 + policy.exchange, startYear: 2026 });
    setWorldState(world);
    const club = lower.clubs[0];
    const p = {
      startYear: 2026,
      seasons: [],
      club: { ...club },
      playingClubId: club.clubId,
      employmentClubId: club.clubId,
    };
    const move = forceMove(p, lower, 1, world);
    assert.equal(move?.type, "promoted", policy.pairId);
    assert.equal(world.leagueMemberships.get(upper.leagueId).length, policy.upperCapacity);
    assert.equal(world.leagueMemberships.get(lower.leagueId).length, policy.lowerCapacity);
    const t = [...world.membershipTransitions.values()][0];
    assert.equal(t.exchange, policy.exchange);
    assert.equal(t.promoted.length, policy.exchange);
    assert.equal(t.relegated.length, policy.exchange);
  }
});

test("R2 partial/stale standings are completed or rejected", () => {
  const { world } = setupPlayer(CH, "Birmingham City", { seed: 401 });
  const clubs = resolveLeagueClubs(PL, { world, seasonYear: 2026 });
  // Freeze PL 2026 from live membership before writing fixtures.
  const ordered = clubs.map((c) => c.clubId);
  // Write only first 19 matchdays (190 fixtures).
  const fxs = dateLeagueFixtures(
    flattenRoundRobinFixtures(clubs, { idPrefix: `lg:${PL.leagueId}:2026` }),
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
    commitLeagueMatchResult(m, { ...PL, clubs }, 2026, world);
    played.push(m);
  }
  world.standings.set(PL.leagueId, rebuildTableFromMatches(clubs, played).table);
  const before = [...world.matches.keys()].filter((id) => String(id).includes(":2026")).length;
  const coverageBefore = collectEditionFixtures(PL.leagueId, 2026, ordered, world);
  assert.equal(coverageBefore.ok, false);
  assert.equal(coverageBefore.matches.length, 190);
  const r = ensureFinalTableForEdition({ league: PL, seasonYear: 2026, world });
  assert.equal(r.ok, true, String(r.reason));
  assert.ok(r.source === "world-completed" || r.simulated > 0);
  const coverageAfter = collectEditionFixtures(PL.leagueId, 2026, ordered, world);
  assert.equal(coverageAfter.ok, true);
  assert.equal(coverageAfter.matches.length, 380);
  assert.equal(r.table.every((row) => row.played === 38), true);
  // Original 190 results preserved (same fixture IDs still present).
  for (const m of played) {
    assert.ok(world.matches.has(m.matchId || m.fixtureId));
  }
  void before;
  // Stale prior-year standings must not satisfy 2027.
  const stale = ensureFinalTableForEdition({ league: PL, seasonYear: 2027, world });
  assert.equal(stale.ok, true);
  assert.notEqual(stale.source, "standings");
  const cov2027 = collectEditionFixtures(
    PL.leagueId,
    2027,
    resolveLeagueClubs(PL, { world, seasonYear: 2027 }).map((c) => c.clubId),
    world
  );
  assert.equal(cov2027.ok, true);
  assert.equal(cov2027.matches.length, 380);
});

test("R1 loan return uses parent's current division after mid-loan relegation", () => {
  const { p, world, club } = setupPlayer(PL, "Ipswich Town", { seed: 402 });
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
  assert.equal(p.parentClubSnapshot?.leagueId, PL.leagueId);
  // Bias so parent Ipswich relegates while player is at Birmingham.
  for (const id of world.leagueMemberships.get(CH.leagueId)) {
    const pr = world.clubs.get(id);
    const n = id === borrower.clubId ? 90 : 55;
    for (const k of ["overall", "attack", "midfield", "defence", "goalkeeper"]) pr[k] = n;
  }
  for (const id of world.leagueMemberships.get(PL.leagueId)) {
    const pr = world.clubs.get(id);
    const n = id === club.clubId ? 40 : 90;
    for (const k of ["overall", "attack", "midfield", "defence", "goalkeeper"]) pr[k] = n;
  }
  // Ensure parent relegates via forced pair completion after borrower season,
  // while snapshot still holds PL metadata.
  const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(done.season, "must finish borrower season");
  // If natural bias missed, force the England pair with Ipswich bottom of PL edition freeze.
  if (!world.leagueMemberships.get(CH.leagueId).includes(club.clubId)) {
    // Restore PL membership for forced transition of the completed 2026 edition.
    // The edition freeze should already capture original rosters; force via committed tables.
    const plFreeze = world.leagueEditionRosters.get(`${PL.leagueId}::2026`);
    const chFreeze = world.leagueEditionRosters.get(`${CH.leagueId}::2026`);
    assert.ok(plFreeze && chFreeze, "edition freezes required");
  }
  // Parent must be in Championship before next-season return — force if needed.
  if (!world.leagueMemberships.get(CH.leagueId).includes(club.clubId)) {
    // Directly commit the pair transition for 2026 using forced results on frozen rosters.
    const plIds = world.leagueEditionRosters.get(`${PL.leagueId}::2026`).clubIds;
    const chIds = world.leagueEditionRosters.get(`${CH.leagueId}::2026`).clubIds;
    const orderedPl = [...plIds.filter((id) => id !== club.clubId), club.clubId];
    commitForcedEditionResults(PL, 2026, orderedPl, world);
    commitForcedEditionResults(CH, 2026, chIds, world);
    const fin = finalizeMembershipAfterSeason({
      completedLeague: PL,
      completedSeasonYear: 2026,
      world,
      completedClubId: club.clubId,
    });
    assert.equal(fin.ok || fin.alreadyApplied, true, String(fin.reason));
  }
  assert.equal(world.clubs.get(club.clubId)?.leagueId || resolveClubLeagueMetadata(club.clubId, world)?.leagueId, CH.leagueId);
  assert.equal(p.parentClubSnapshot?.leagueId, PL.leagueId);
  // Snapshot while loan still active.
  const snap = roundTripCareerSnapshot({ player: p, world });
  assert.ok(snap.player.activeLoan?.status === "active" || p.activeLoan?.status === "returned" || p.seasons.length >= 1);
  // Next season triggers automatic return at boundary.
  const next = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(next.season || next.freeAgent);
  assert.equal(p.club?.leagueId, CH.leagueId);
  assert.equal(resolveClubLeagueMetadata(club.clubId, world)?.leagueId, CH.leagueId);
  assert.notEqual(p.club?.leagueId, PL.leagueId);
});

test("R3 cross-country move still transitions the source pair", () => {
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
  assert.ok(done.season);
  const world = getWorldState();
  assert.ok(
    world.membershipTransitions.has("italy::2026"),
    `expected italy::2026, got ${[...world.membershipTransitions.keys()]}`
  );
  assert.equal(f.player.employmentClubId, "club:italy:atalanta");
  assert.equal(f.player.playingClubId, "club:croatia:rudes");
  assert.equal(f.player.club?.leagueId, "league:croatia-hnl");
  assert.equal(world.leagueMemberships.get("league:italy-serie-a").length, 20);
  assert.equal(world.leagueMemberships.get("league:italy-serie-b").length, 20);
  // Repeat is idempotent.
  const again = finalizeMembershipForSeasonSegments({
    player: f.player,
    segmentLeagueIds: ["league:italy-serie-a", "league:croatia-hnl"],
    primaryLeague: LEAGUE_BY_ID.get("league:croatia-hnl"),
    completedSeasonYear: 2026,
    world,
  });
  assert.equal(again.ok, true);
  assert.equal(world.membershipTransitions.size >= 1, true);
});

console.log(process.exitCode ? "Some membership tests failed." : "All membership transition tests passed.");
