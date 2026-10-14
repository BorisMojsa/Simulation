/**
 * League simulation dashboard data helpers.
 * Run: node tests/leagueSimulationDashboard.test.mjs
 */
import assert from "node:assert/strict";
import {
  rebuildTableFromMatches,
  buildScoreRevealPath,
  formatMatchContribution,
  matchKey,
  ensureLeagueMatchId,
  groupMatchesByMatchday,
} from "../js/simulation/leagueTable.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createRng } from "../js/simulation/rng.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`OK  ${name}`))
        .catch((e) => {
          console.error(`FAIL ${name}`);
          console.error(e);
          process.exitCode = 1;
        });
    }
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function clubs() {
  return [
    { name: "Alpha", displayName: "Alpha FC", clubId: "a", overall: 80, badge: null },
    { name: "Beta", displayName: "Beta FC", clubId: "b", overall: 75, badge: null },
    { name: "Gamma", displayName: "Gamma FC", clubId: "g", overall: 70, badge: null },
    { name: "Delta", displayName: "Delta FC", clubId: "d", overall: 68, badge: null },
  ];
}

test("rebuildTableFromMatches is idempotent by fixtureId", () => {
  const seed = clubs();
  const matches = [
    {
      fixtureId: "md1-1",
      home: seed[0],
      away: seed[1],
      homeGoals: 2,
      awayGoals: 1,
      matchday: 1,
    },
    {
      fixtureId: "md1-2",
      home: seed[2],
      away: seed[3],
      homeGoals: 0,
      awayGoals: 0,
      matchday: 1,
    },
  ];
  const first = rebuildTableFromMatches(seed, matches);
  assert.equal(first.table.find((r) => r.name === "Alpha").points, 3);
  assert.equal(first.table.find((r) => r.name === "Alpha").played, 1);
  assert.equal(first.table.find((r) => r.name === "Alpha").goalsFor, 2);
  assert.equal(first.table.find((r) => r.name === "Alpha").goalsAgainst, 1);

  // Duplicate fixtureIds in one rebuild are applied once
  const applied = new Set();
  const once = rebuildTableFromMatches(seed, [...matches, ...matches], { appliedIds: applied });
  assert.equal(once.table.find((r) => r.name === "Alpha").played, 1);
  assert.equal(once.table.find((r) => r.name === "Alpha").points, 3);
  assert.equal(applied.size, 2);

  // Matches without ids can still double-count — dashboard always stamps matchId
  const noIds = matches.map(({ home, away, homeGoals, awayGoals }) => ({
    home,
    away,
    homeGoals,
    awayGoals,
  }));
  const dup = rebuildTableFromMatches(seed, [...noIds, ...noIds]);
  assert.equal(dup.table.find((r) => r.name === "Alpha").played, 2);
});

test("goal totals balance across the table", () => {
  const seed = clubs();
  const matches = [
    { fixtureId: "1", home: seed[0], away: seed[1], homeGoals: 3, awayGoals: 1 },
    { fixtureId: "2", home: seed[2], away: seed[3], homeGoals: 2, awayGoals: 2 },
  ];
  const { table } = rebuildTableFromMatches(seed, matches);
  const gf = table.reduce((s, r) => s + r.goalsFor, 0);
  const ga = table.reduce((s, r) => s + r.goalsAgainst, 0);
  assert.equal(gf, ga);
  assert.equal(gf, 8);
});

test("buildScoreRevealPath is monotonic and never exceeds finals", () => {
  const match = {
    fixtureId: "x",
    homeGoals: 2,
    awayGoals: 1,
    events: [
      { type: "goal", team: "home", minute: 12 },
      { type: "goal", team: "away", minute: 40 },
      { type: "goal", team: "home", minute: 77 },
    ],
  };
  const { path, finalHome, finalAway } = buildScoreRevealPath(match);
  assert.equal(finalHome, 2);
  assert.equal(finalAway, 1);
  let prevH = 0;
  let prevA = 0;
  for (const node of path) {
    assert.ok(node.home >= prevH);
    assert.ok(node.away >= prevA);
    assert.ok(node.home <= finalHome);
    assert.ok(node.away <= finalAway);
    prevH = node.home;
    prevA = node.away;
  }
  const last = path[path.length - 1];
  assert.equal(last.home, 2);
  assert.equal(last.away, 1);
});

test("cosmetic reveal for missing events is deterministic", () => {
  const match = { fixtureId: "cos-1", homeGoals: 2, awayGoals: 0, events: [], home: { name: "A" }, away: { name: "B" } };
  const a = buildScoreRevealPath(match);
  const b = buildScoreRevealPath(match);
  assert.equal(a.cosmetic, true);
  assert.deepEqual(
    a.path.map((p) => [p.t, p.home, p.away]),
    b.path.map((p) => [p.t, p.home, p.away])
  );
});

test("formatMatchContribution covers striker, GK, and unused", () => {
  const striker = formatMatchContribution(
    {
      playerSide: "home",
      homeGoals: 2,
      awayGoals: 1,
      playerStats: { played: true, minutes: 90, started: true, goals: 1, assists: 0, rating: 7.4 },
    },
    { position: "ST" }
  );
  assert.equal(striker.kind, "outfield");
  assert.match(striker.text, /1G \/ 0A/);
  assert.equal(striker.ratingText, "7.4");

  const gk = formatMatchContribution(
    {
      playerSide: "away",
      homeGoals: 0,
      awayGoals: 1,
      playerStats: { played: true, minutes: 90, started: true, rating: 7.1 },
    },
    { position: "GK" }
  );
  assert.equal(gk.kind, "gk");
  assert.match(gk.text, /Clean sheet/);
  assert.equal(gk.cleanSheet, true);

  const unused = formatMatchContribution(
    {
      playerSide: "home",
      homeGoals: 1,
      awayGoals: 0,
      playerStats: {
        played: false,
        minutes: 0,
        nonParticipationReason: "unused",
      },
    },
    { position: "CM" }
  );
  assert.equal(unused.kind, "no-appearance");
  assert.equal(unused.ratingText, "—");
  assert.match(unused.text, /Unused/i);
});

test("groupMatchesByMatchday separates player fixtures", () => {
  const seed = clubs();
  const all = [
    { matchday: 1, fixtureId: "a", home: seed[0], away: seed[1], playerSide: "home" },
    { matchday: 1, fixtureId: "b", home: seed[2], away: seed[3], playerSide: null },
    { matchday: 2, fixtureId: "c", home: seed[0], away: seed[2], playerSide: "home" },
  ];
  const groups = groupMatchesByMatchday(all);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].matches.length, 2);
  assert.equal(groups[0].playerMatches.length, 1);
});

test("ensureLeagueMatchId is stable", () => {
  const m = {
    competitionId: "eng-1",
    date: "2026-08-15",
    home: { clubId: "x", name: "X" },
    away: { clubId: "y", name: "Y" },
  };
  ensureLeagueMatchId(m);
  const id1 = matchKey(m);
  ensureLeagueMatchId(m);
  assert.equal(matchKey(m), id1);
});

test("simulateSeason exposes leagueAllMatches on complete seasons", () => {
  setWorldState(createWorldState());
  const league = LEAGUES.find((l) => l.clubs?.length >= 10) || LEAGUES[0];
  const club = league.clubs[0];
  const rng = createRng(99);
  const attrs = generateStartingAttributes("ST", 70, 90, rng);
  const player = {
    name: "Dash Tester",
    nationality: "England",
    position: "ST",
    age: 20,
    startYear: 2026,
    club: { ...club, league: league.name, leagueId: league.leagueId },
    playingClubId: club.clubId,
    employmentClubId: club.clubId,
    attributes: attrs,
    seasons: [],
    careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
    careerHonors: {
      leagueTitles: 0,
      domesticCups: 0,
      europeanTitles: 0,
      internationalTitles: 0,
      individualAwards: 0,
    },
  };
  initializePlayerDevelopment(player, { rng });
  refreshAbilityCaches(player);

  const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(result.season);
  assert.ok(Array.isArray(result.leagueAllMatches));
  assert.ok(result.leagueAllMatches.length > result.season.leagueMatches.length);
  assert.ok(Array.isArray(result.season.leagueAllMatches));
  assert.equal(result.season.leagueAllMatches.length, result.leagueAllMatches.length);

  // Final table matches recomputation from full results
  const seed = (result.league.clubs || []).map((c) => ({
    name: c.name,
    displayName: c.displayName,
    badge: c.badge,
    clubId: c.clubId,
    strength: c.overall,
    overall: c.overall,
  }));
  const rebuilt = rebuildTableFromMatches(seed, result.leagueAllMatches);
  assert.equal(rebuilt.table.length, result.standings.table.length);
  for (let i = 0; i < rebuilt.table.length; i++) {
    const a = rebuilt.table[i];
    const b = result.standings.table.find((r) => r.clubId === a.clubId || r.name === a.name);
    assert.ok(b, `missing ${a.name}`);
    assert.equal(a.points, b.points, `${a.name} points`);
    assert.equal(a.played, b.played, `${a.name} played`);
    assert.equal(a.goalsFor, b.goalsFor, `${a.name} GF`);
  }

  const gf = rebuilt.table.reduce((s, r) => s + r.goalsFor, 0);
  const ga = rebuilt.table.reduce((s, r) => s + r.goalsAgainst, 0);
  assert.equal(gf, ga);
});

test("pause payload surfaces partial league matches", () => {
  setWorldState(createWorldState());
  const league = LEAGUES.find((l) => l.name?.includes("Premier") || l.leagueId?.includes("eng")) || LEAGUES[0];
  const club = league.clubs[3] || league.clubs[0];
  const rng = createRng(7);
  const attrs = generateStartingAttributes("CM", 72, 90, rng);
  const player = {
    name: "Pause Tester",
    nationality: "England",
    position: "CM",
    age: 21,
    startYear: 2026,
    club: { ...club, league: league.name, leagueId: league.leagueId, isAcademy: false },
    playingClubId: club.clubId,
    employmentClubId: club.clubId,
    attributes: attrs,
    seasons: [],
    careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
    careerHonors: {
      leagueTitles: 0,
      domesticCups: 0,
      europeanTitles: 0,
      internationalTitles: 0,
      individualAwards: 0,
    },
  };
  initializePlayerDevelopment(player, { rng });
  refreshAbilityCaches(player);

  const paused = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  if (paused.awaitingDecision || paused.awaitingScenario) {
    assert.ok(Array.isArray(paused.partialLeagueAllMatches));
    assert.ok(paused.partialLeagueAllMatches.length > 0);
    assert.ok(Array.isArray(paused.partialLeaguePlayerMatches));
    // Reveal cursor simulation: IDs unique
    const ids = paused.partialLeagueAllMatches.map((m) => ensureLeagueMatchId(m) && matchKey(m));
    assert.equal(new Set(ids).size, ids.length);
  } else {
    // Some careers may complete without a winter pause depending on calendar
    assert.ok(paused.season);
    console.log("  (note: season completed without pause in this fixture)");
  }
});
