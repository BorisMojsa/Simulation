/**
 * Chronological season + budget-record regression tests.
 * Run: node tests/chronologicalSeason.test.mjs
 */
import assert from "node:assert/strict";
import { createRng, createStreamRng } from "../js/simulation/rng.js";
import {
  developSeason,
  ensureAbilityBudgets,
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { applyInjury, isAvailable } from "../js/simulation/playerHealth.js";
import { toDay } from "../js/simulation/playerState.js";
import { processPlayerMatchDay } from "../js/simulation/playerMatchDay.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { LEAGUES } from "../js/data/leagues.js";
import { getOrUpdateForecast } from "../js/simulation/playerPotential.js";

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

function makePlayer(pos = "RW", target = 68, age = 19) {
  const rng = createRng(42);
  const budget = 88;
  const attrs = generateStartingAttributes(pos, target, budget, rng);
  const player = {
    name: "Chrono Test",
    nationality: "England",
    position: pos,
    age,
    careerId: "chrono-test-1",
    attributes: attrs,
    rating: target,
    startYear: 2026,
    club: {
      name: "Arsenal",
      displayName: "Arsenal",
      clubId: "arsenal",
      league: "England - Premier League",
      leagueDisplay: "Premier League",
      nation: "England",
      overall: 84,
      badge: null,
      financialTier: 5,
      tier: 5,
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId, budget });
  setWorldState(createWorldState(player));
  return player;
}

test("ensureAbilityBudgets: bare number normalizes; object record preserved", () => {
  const p = makePlayer("CM", 65, 18);
  p.development.abilityBudgetsByPosition = { CM: 82 };
  const rec = ensureAbilityBudgets(p);
  assert.equal(typeof rec, "object");
  assert.equal(rec.budget, 82);
  assert.ok(Number.isFinite(rec.startOverallRaw));
  assert.equal(rec.used, 0);
  // Shape mismatch must not throw when developSeason charges used
  const before = p.baseOverallRaw;
  developSeason(p, {
    rng: createRng(3),
    seasonId: "budget-num",
    usefulMinutes: 2000,
    healthyTrainingFraction: 1,
    reliableSignal: 0.4,
    P_long: 0.4,
    reliability: 0.7,
    environmentMultiplier: 1.1,
    alreadyAppliedLearningGain: 0,
    longFormReliable: true,
  });
  const after = ensureAbilityBudgets(p);
  assert.equal(typeof after.used, "number");
  assert.ok(after.used >= 0);
  assert.ok(p.baseOverallRaw >= before - 0.01);

  const q = makePlayer("ST", 70, 20);
  q.development.abilityBudgetsByPosition = {
    ST: { budget: 90, startOverallRaw: q.baseOverallRaw, used: 1.5, primary: true },
  };
  const rec2 = ensureAbilityBudgets(q);
  assert.equal(rec2.budget, 90);
  assert.equal(rec2.used, 1.5);
  assert.equal(rec2.startOverallRaw, q.baseOverallRaw);
});

test("cup injury blocks later league minutes (dated match-day chain)", () => {
  const player = makePlayer("RW", 70, 21);
  const home = {
    name: "Arsenal",
    displayName: "Arsenal",
    clubId: "arsenal",
    overall: 84,
    attack: 84,
    midfield: 82,
    defence: 80,
    goalkeeper: 80,
  };
  const away = {
    name: "Opp",
    displayName: "Opp",
    clubId: "opp",
    overall: 72,
    attack: 72,
    midfield: 70,
    defence: 70,
    goalkeeper: 70,
  };
  const rng = createRng(99);
  const selRng = createStreamRng(player.careerId, "sel");
  const injuryRng = createStreamRng(player.careerId, "inj");

  // Cup match on Dec 10 — force a mid-length injury afterward.
  const cup = processPlayerMatchDay({
    home,
    away,
    player,
    playerSide: "home",
    date: "2026-12-10",
    lastDate: null,
    competition: "cup",
    competitionType: "domesticCup",
    competitionId: "FA Cup",
    fixtureId: "cup:force",
    teamType: "club",
    competitionPriority: 0.9,
    rng,
    selRng,
    injuryRng,
  });
  assert.ok(cup.match);

  const startDay = toDay("2026-12-10");
  applyInjury(player, {
    eventId: "forced-cup-injury",
    kind: "match",
    severity: "moderate",
    date: "2026-12-10",
    startDay,
    durationDays: 28,
    expectedReturnDate: "2027-01-07",
    expectedReturnDay: startDay + 28,
    temporaryEffects: { overallPenalty: 4, scale: 1, attributePenalties: {} },
    returnReadiness: 0.55,
  });
  assert.equal(isAvailable(player.health, "2026-12-20"), false);

  const league = processPlayerMatchDay({
    home,
    away: { ...away, name: "LeagueOpp", clubId: "league-opp" },
    player,
    playerSide: "home",
    date: "2026-12-28",
    lastDate: "2026-12-10",
    competition: "league",
    competitionType: "league",
    competitionId: "England - Premier League",
    fixtureId: "league:after-cup",
    teamType: "club",
    competitionPriority: 1,
    rng,
    selRng: createStreamRng(player.careerId, "sel2"),
    injuryRng: createStreamRng(player.careerId, "inj2"),
  });
  assert.ok(league.participation);
  assert.equal(league.participation.available, false);
  assert.equal(league.ledgerRecord?.minutes ?? 0, 0);
  assert.ok(
    league.ledgerRecord?.nonParticipationReason || !league.participation.selected,
    "injured player must not contribute league minutes"
  );
});

test("simulateChronologicalSeason returns interleaved competitions", () => {
  const player = makePlayer("CM", 72, 22);
  const league = LEAGUES.find((l) => l.name === player.club.league) || LEAGUES[0];
  // Align club with a real league club when possible
  const club = league.clubs?.[0];
  if (club) {
    player.club = {
      ...player.club,
      name: club.name,
      displayName: club.displayName ?? club.name,
      clubId: club.clubId,
      badge: club.badge,
      overall: club.overall ?? player.club.overall,
      league: league.name,
      leagueDisplay: league.displayName ?? league.name,
      nation: league.nation,
    };
  }
  const result = simulateChronologicalSeason({ player, league, seasonIndex: 0 });
  assert.ok(result.table?.length >= 2);
  assert.ok(result.playerRecord);
  assert.ok(result.domesticCupResult?.name);
  assert.ok(result.chronology?.events > 0);
  assert.ok(Array.isArray(result.ledgerRecords));
  // League player matches dated
  for (const m of result.playerMatches.slice(0, 3)) {
    assert.ok(m.date, "league match should carry a simulation date");
  }
});

test("exceptional age-20 fixture: high budget can reach world-class", () => {
  // Supported fixture: elite latent budget + elite environment from 16 → 20.
  // Demonstrates the ceiling is reachable early; not a claim about typical careers.
  const rng = createRng(2020);
  const budget = 99;
  const attrs = generateStartingAttributes("ST", 80, budget, rng);
  const player = {
    name: "Exceptional Fixture",
    nationality: "Brazil",
    position: "ST",
    age: 16,
    careerId: "exceptional-20",
    attributes: attrs,
    rating: 80,
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId, budget });
  player.development.latentAbilityBudget = 99;
  player.development.abilityBudgetsByPosition = {
    ST: { budget: 99, startOverallRaw: player.baseOverallRaw, used: 0, primary: true },
  };
  player.development.traits.trainability = 1.3;
  player.development.traits.injuryProneness = 0.7;

  for (let y = 0; y < 4; y++) {
    developSeason(player, {
      elapsedYears: 1,
      usefulMinutes: 3000,
      healthyTrainingFraction: 1,
      reliableSignal: 0.95,
      P_long: 0.95,
      reliability: 0.9,
      environmentMultiplier: 1.4,
      rng: rng.fork(`ex-${y}`),
      seasonId: `ex-${y}`,
      alreadyAppliedLearningGain: 0,
      longFormReliable: true,
    });
    player.age += 1;
  }
  refreshAbilityCaches(player);
  assert.equal(player.age, 20);
  assert.ok(
    player.baseOverallRaw >= 90,
    `world-class at 20 remains possible; got ${player.baseOverallRaw}`
  );
  const fc = getOrUpdateForecast(player, { sampleCount: 32 });
  assert.ok(fc.potentialCache >= player.rating);
});

console.log("chronologicalSeason tests done");
