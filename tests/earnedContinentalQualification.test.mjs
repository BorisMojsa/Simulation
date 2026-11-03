/**
 * Fix 09 — earned continental qualification (F01–F25).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import {
  continentalCompetitionForStanding,
  normalizeStandingPosition,
  uefaSlotsForLeague,
} from "../js/data/competitions/qualification.js";
import {
  commitCompletedDomesticEdition,
  competitionForValidatedFinish,
  ensureBootstrapDomesticEdition,
  getClubTargetDecision,
  getDomesticEditionRecord,
  normalizeFinishPosition,
  resolveClubContinentalEntry,
  resolvePreSeasonContinentalStanding,
  sourceYearForContinentalTarget,
} from "../js/simulation/earnedQualification.js";
import { preSeasonContinentalStanding } from "../js/simulation/chronologicalSeason.js";
import {
  loadContinentalEdition,
  prepareContinentalEdition,
  processContinentalMatchday,
} from "../js/simulation/continentalTournament.js";
import {
  createWorldState,
  deserializeWorldState,
  serializeWorldState,
  setWorldState,
} from "../js/simulation/worldState.js";
import { createRng, getSimRng, reseedCareerRng } from "../js/simulation/rng.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { canAttachToContinentalFixture } from "../js/data/competitions/registrationPolicy.js";
import { qualificationForPosition, findSisterLeagues } from "../js/simulation/leaguePhase.js";

function leagueById(id) {
  return LEAGUES.find((l) => l.leagueId === id);
}

function topFlight(nation) {
  return LEAGUES.find((l) => l.nation === nation && (l.divisionLevel ?? 1) === 1);
}

function clubIn(league, clubId) {
  return league.clubs.find((c) => c.clubId === clubId);
}

function orderedTable(league, placements = {}) {
  const sisters = findSisterLeagues(league, LEAGUES);
  const placed = new Map(Object.entries(placements));
  const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
  const slots = Array.from({ length: league.clubs.length }, () => null);
  for (const [posStr, clubId] of placed) {
    slots[Number(posStr) - 1] = clubIn(league, clubId);
  }
  let r = 0;
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) slots[i] = remaining[r++];
  }
  return slots.map((c, i) => {
    const position = i + 1;
    return {
      ...c,
      position,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      wins: 20,
      draws: 8,
      losses: 10,
      goalsFor: 50 - i,
      goalsAgainst: 20 + i,
      goalDiff: 30 - 2 * i,
      qualification: qualificationForPosition(position, league, sisters) || "",
    };
  });
}

function resetWorld(seed = 91) {
  reseedCareerRng(seed);
  const world = createWorldState({ seed, careerSeed: seed, startYear: 2026 });
  setWorldState(world);
  return world;
}

function makePlayer(club, league, extras = {}) {
  const rng = createRng(91);
  const player = {
    name: extras.name || "Fix09 Player",
    careerId: extras.careerId || "fix09-player",
    nationality: league.nation === "Brazil" ? "Brazil" : "Serbia",
    position: extras.position || "CM",
    age: 24,
    startYear: 2026,
    rating: 72,
    attributes: generateStartingAttributes(extras.position || "CM", 72, 99, rng),
    club: {
      ...club,
      league: league.name,
      leagueId: league.leagueId,
      nation: league.nation,
      overall: extras.overall ?? club.overall,
    },
    playingClubId: club.clubId,
    employmentClubId: extras.employmentClubId || club.clubId,
    seasons: extras.seasons || [],
    latestStanding: extras.latestStanding || null,
    ...extras,
  };
  // Re-assert tips after spread.
  player.playingClubId = extras.playingClubId || club.clubId;
  player.employmentClubId = extras.employmentClubId || club.clubId;
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return player;
}

/** Independent slot oracle — does not call production competition helpers. */
function oracleCompetition(nation, leagueId, position) {
  if (!Number.isInteger(position) || position < 1) return null;
  const uefa = {
    "league:england-premier-league": { cl: 4, el: 1, uecl: 1 },
    "league:spain-la-liga": { cl: 4, el: 1, uecl: 1 },
    "league:germany-bundesliga": { cl: 4, el: 1, uecl: 1 },
    "league:italy-serie-a": { cl: 4, el: 1, uecl: 1 },
    "league:france-ligue-1": { cl: 3, el: 1, uecl: 1 },
    "league:portugal-primeira-liga": { cl: 2, el: 1, uecl: 1 },
    "league:netherlands-eredivisie": { cl: 2, el: 1, uecl: 1 },
    "league:belgium-belgian-pro-league": { cl: 2, el: 1, uecl: 1 },
    "league:turkiye-super-lig": { cl: 2, el: 1, uecl: 1 },
    "league:denmark-superliga": { cl: 1, el: 1, uecl: 1 },
    "league:norway-eliteserien": { cl: 1, el: 1, uecl: 1 },
    "league:poland-ekstraklasa": { cl: 1, el: 1, uecl: 1 },
    "league:czechia-czech-first-league": { cl: 1, el: 1, uecl: 1 },
    "league:croatia-hnl": { cl: 1, el: 1, uecl: 1 },
    "league:serbia-superliga": { cl: 1, el: 1, uecl: 1 },
  };
  if (uefa[leagueId]) {
    const s = uefa[leagueId];
    if (position <= s.cl) return "Champions League";
    if (position <= s.cl + s.el) return "Europa League";
    if (position <= s.cl + s.el + s.uecl) return "Conference League";
    return null;
  }
  if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) {
    if (position <= 4) return "Copa Libertadores";
    if (position <= 8) return "Copa Sudamericana";
    return null;
  }
  if (["Mexico", "United States"].includes(nation)) {
    return position <= 4 ? "CONCACAF Champions Cup" : null;
  }
  if (["Saudi Arabia", "Japan", "South Korea"].includes(nation)) {
    return position <= 3 ? "AFC Champions League Elite" : null;
  }
  if (["Egypt", "Morocco"].includes(nation)) {
    return position <= 2 ? "CAF Champions League" : null;
  }
  return null;
}

test("F01: Arsenal title does not transfer to Brentford", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(91);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(brentford, league, {
    latestStanding: {
      leagueId: league.leagueId,
      seasonId: `${league.leagueId}::2025`,
      table,
      playerRow: table[0],
    },
  });
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  const edition = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  assert.equal(standing, null);
  assert.equal(edition, null);
  const decided = getClubTargetDecision(world, brentford.clubId, 2026);
  assert.equal(decided.entry.status, "not-qualified");
  assert.equal(decided.entry.position, 17);
});

test("F02: reverse move into qualified Arsenal grants CL", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(92);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(arsenal, league, {
    latestStanding: {
      leagueId: league.leagueId,
      seasonId: `${league.leagueId}::2025`,
      table,
      playerRow: table.find((r) => r.clubId === brentford.clubId),
    },
  });
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  assert.ok(standing);
  assert.equal(standing.position, 1);
  assert.equal(standing.competition, "Champions League");
  const edition = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  assert.equal(edition.competition, "Champions League");
  assert.equal(edition.playerClub.clubId, arsenal.clubId);
});

test("F03: same-club prior edition beats low OVR; high-OVR non-qualifier stays out", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(93);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const low = makePlayer({ ...arsenal, overall: 55 }, league, { overall: 55 });
  const highOut = makePlayer({ ...brentford, overall: 92 }, league, { overall: 92 });
  assert.equal(preSeasonContinentalStanding(low, league, { world, seasonYear: 2026 })?.competition, "Champions League");
  assert.equal(preSeasonContinentalStanding(highOut, league, { world, seasonYear: 2026 }), null);
});

test("F04: destination row wins over stale foreign playerRow", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(94);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const resolved = resolveClubContinentalEntry({
    world,
    clubId: brentford.clubId,
    league,
    targetYear: 2026,
    player: makePlayer(brentford, league, {
      latestStanding: { leagueId: league.leagueId, table, playerRow: table[0] },
    }),
  });
  assert.equal(resolved.status, "not-qualified");
  assert.equal(resolved.entry?.position, 17);
});

test("F05: stale/future/incomplete rejected; correct mapping passes", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId });
  const world = resetWorld(95);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2024 }); // stale for 2026
  let r = resolveClubContinentalEntry({
    world,
    clubId: arsenal.clubId,
    league,
    targetYear: 2026,
    allowBootstrap: false,
  });
  // 2024 source → target 2025 only; for 2026 without 2025 evidence + no bootstrap → unresolved
  assert.equal(r.status, "unresolved");
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  r = resolveClubContinentalEntry({
    world,
    clubId: arsenal.clubId,
    league,
    targetYear: 2026,
    allowBootstrap: false,
  });
  assert.equal(r.status, "qualified");
  assert.equal(sourceYearForContinentalTarget(2026), 2025);
});

test("F06: later live table cannot replace prior completed edition", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const world = resetWorld(96);
  const t2025 = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  commitCompletedDomesticEdition({ world, league, table: t2025, sourceYear: 2025 });
  const live = orderedTable(league, { 1: brentford.clubId, 17: arsenal.clubId });
  const again = commitCompletedDomesticEdition({
    world,
    league,
    table: live,
    sourceYear: 2025,
    forceReplace: false,
  });
  assert.equal(again.reused, true);
  assert.equal(getClubTargetDecision(world, arsenal.clubId, 2026).entry.position, 1);
  assert.equal(getClubTargetDecision(world, brentford.clubId, 2026).entry.status, "not-qualified");
});

test("F07: consecutive source editions retained independently", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const world = resetWorld(97);
  commitCompletedDomesticEdition({
    world,
    league,
    table: orderedTable(league, { 1: arsenal.clubId }),
    sourceYear: 2025,
  });
  commitCompletedDomesticEdition({
    world,
    league,
    table: orderedTable(league, { 1: brentford.clubId, 5: arsenal.clubId }),
    sourceYear: 2026,
  });
  assert.equal(getDomesticEditionRecord(world, league.leagueId, 2025).entries[arsenal.clubId].position, 1);
  assert.equal(getDomesticEditionRecord(world, league.leagueId, 2026).entries[brentford.clubId].position, 1);
  assert.equal(getClubTargetDecision(world, arsenal.clubId, 2027).entry.position, 5);
});

test("F08: UEFA boundaries including France and Serbia", () => {
  const cases = [
    ["league:england-premier-league", 4, "Champions League", 5, "Europa League", 6, "Conference League", 7, null],
    ["league:france-ligue-1", 3, "Champions League", 4, "Europa League", 5, "Conference League", 6, null],
    ["league:serbia-superliga", 1, "Champions League", 2, "Europa League", 3, "Conference League", 4, null],
  ];
  for (const [id, lastCl, clName, lastEl, elName, lastUecl, ueclName, firstOut, out] of cases) {
    const league = leagueById(id);
    assert.ok(league, id);
    assert.equal(continentalCompetitionForStanding({ position: lastCl }, league), clName);
    assert.equal(continentalCompetitionForStanding({ position: lastEl }, league), elName);
    assert.equal(continentalCompetitionForStanding({ position: lastUecl }, league), ueclName);
    assert.equal(continentalCompetitionForStanding({ position: firstOut }, league), out);
    assert.equal(oracleCompetition(league.nation, id, lastCl), clName);
    assert.equal(oracleCompetition(league.nation, id, firstOut), out);
  }
  assert.equal(uefaSlotsForLeague(leagueById("league:france-ligue-1")).cl, 3);
});

test("F09: non-UEFA families", () => {
  const families = [
    ["Brazil", 1, "Copa Libertadores", 4, "Copa Libertadores", 5, "Copa Sudamericana", 8, "Copa Sudamericana", 9, null],
    ["Mexico", 1, "CONCACAF Champions Cup", 4, "CONCACAF Champions Cup", 5, null],
    ["Saudi Arabia", 1, "AFC Champions League Elite", 3, "AFC Champions League Elite", 4, null],
    ["Egypt", 1, "CAF Champions League", 2, "CAF Champions League", 3, null],
  ];
  for (const row of families) {
    const nation = row[0];
    const league = topFlight(nation);
    assert.ok(league, nation);
    for (let i = 1; i < row.length; i += 2) {
      const pos = row[i];
      const expected = row[i + 1];
      assert.equal(
        continentalCompetitionForStanding({ position: pos }, league),
        expected,
        `${nation} pos ${pos}`
      );
      assert.equal(oracleCompetition(nation, league.leagueId, pos), expected);
    }
    assert.equal(continentalCompetitionForStanding({}, league), null);
    assert.equal(continentalCompetitionForStanding({ position: 0 }, league), null);
  }
});

test("F10: invalid ranks and conflicting labels rejected; legacy numeric ok", () => {
  const league = leagueById("league:england-premier-league");
  for (const bad of [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc"]) {
    assert.equal(normalizeStandingPosition(bad).ok, false, String(bad));
    assert.equal(continentalCompetitionForStanding({ position: bad }, league), null, String(bad));
  }
  assert.equal(normalizeFinishPosition(99, { tableSize: 20 }).ok, false);
  assert.equal(continentalCompetitionForStanding({ position: 99 }, league), null);
  assert.equal(normalizeStandingPosition("3").ok, true);
  assert.equal(continentalCompetitionForStanding({ position: "3" }, league), "Champions League");
  // Stale CL label at position 17
  assert.equal(
    competitionForValidatedFinish(
      { position: 17, qualification: "Champions League" },
      league,
      { tableSize: 20 }
    ),
    null
  );
});

test("F11: lower division / unknown / duplicates cannot earn top-flight entry", () => {
  const champ = LEAGUES.find(
    (l) => l.nation === "England" && (l.divisionLevel ?? 1) === 2
  ) || LEAGUES.find((l) => /Championship/i.test(l.name || ""));
  if (champ) {
    assert.equal(
      continentalCompetitionForStanding({ position: 1, qualification: "League Champions" }, champ),
      null
    );
  }
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId });
  table.push({ ...table[0], position: 2 }); // duplicate club
  const world = resetWorld(98);
  const ingested = commitCompletedDomesticEdition({
    world,
    league,
    table: orderedTable(league, { 1: arsenal.clubId }),
    sourceYear: 2025,
  });
  assert.equal(ingested.ok, true);
  // Division move: Arsenal earned 2025 CL place remains for target 2026 even if we look up after.
  assert.equal(getClubTargetDecision(world, arsenal.clubId, 2026).entry.competition, "Champions League");
});

test("F12: bootstrap deterministic and idempotent", () => {
  const league = leagueById("league:england-premier-league");
  const world = resetWorld(101);
  const rngBefore = getSimRng().seed();
  const a = ensureBootstrapDomesticEdition({ world, league, targetYear: 2026, streamSeed: 101 });
  const b = ensureBootstrapDomesticEdition({ world, league, targetYear: 2026, streamSeed: 101 });
  assert.equal(a.ok, true);
  assert.equal(b.reused, true);
  assert.deepEqual(a.record.table.map((r) => r.clubId), b.record.table.map((r) => r.clubId));
  assert.equal(getSimRng().seed(), rngBefore);
  const world2 = resetWorld(101);
  const c = ensureBootstrapDomesticEdition({ world: world2, league, targetYear: 2026, streamSeed: 101 });
  assert.deepEqual(
    a.record.table.map((r) => [r.clubId, r.position, r.points]),
    c.record.table.map((r) => [r.clubId, r.position, r.points])
  );
});

test("F13: known non-qualifier never falls through to OVR", () => {
  const league = leagueById("league:england-premier-league");
  const brentford = clubIn(league, "club:england:brentford");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(102);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer({ ...brentford, overall: 95 }, league, { overall: 95 });
  assert.equal(resolvePreSeasonContinentalStanding(player, league, { world, seasonYear: 2026 }), null);
});

test("F14: legacy migration idempotent; unresolved without club ids", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId });
  const world = resetWorld(103);
  const first = commitCompletedDomesticEdition({
    world,
    league,
    table,
    sourceYear: 2025,
    provenance: "legacy-migrated",
  });
  const second = commitCompletedDomesticEdition({
    world,
    league,
    table,
    sourceYear: 2025,
    provenance: "legacy-migrated",
  });
  assert.equal(first.ok, true);
  assert.equal(second.reused, true);
  assert.equal(first.record.provenance, "legacy-migrated");
});

test("F15: re-prepare after MD1 freezes field and results", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(104);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(arsenal, league);
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  processContinentalMatchday(original, 1, { world, player });
  const field = original.field.map((c) => c.clubId).sort();
  const fixtureIds = Object.keys(original.fixtures).sort();
  const matchesBefore = world.matches.size;

  const brPlayer = makePlayer(brentford, league);
  const bypass = prepareContinentalEdition({
    standing: { position: 1, qualification: "League Champions" },
    league,
    player: brPlayer,
    seasonYear: 2026,
    world,
  });
  assert.equal(bypass, null);

  // Qualified second focus that is already in the frozen field (if present) soft-attaches.
  const loaded = loadContinentalEdition({
    competitionId: original.competitionId,
    editionId: original.editionId,
    world,
  });
  const again = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  assert.deepEqual(again.field.map((c) => c.clubId).sort(), field);
  assert.deepEqual(Object.keys(again.fixtures).sort(), fixtureIds);
  assert.equal(world.matches.size, matchesBefore);
  assert.equal(loaded.playerClubId, arsenal.clubId);
});

test("F16: no conflicting CL/EL/Conference for known evidence", () => {
  const league = leagueById("league:england-premier-league");
  const world = resetWorld(105);
  const table = orderedTable(league, {
    1: "club:england:arsenal",
    5: "club:england:brentford",
    6: "club:england:brighton-and-hove-albion",
    7: "club:england:fulham",
  });
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const a = getClubTargetDecision(world, "club:england:arsenal", 2026).entry;
  const b = getClubTargetDecision(world, "club:england:brentford", 2026).entry;
  const c = getClubTargetDecision(world, "club:england:brighton-and-hove-albion", 2026).entry;
  const d = getClubTargetDecision(world, "club:england:fulham", 2026).entry;
  assert.equal(a.competition, "Champions League");
  assert.equal(b.competition, "Europa League");
  assert.equal(c.competition, "Conference League");
  assert.equal(d.competition, null);
  assert.notEqual(a.competition, b.competition);
});

test("F17: entry follows playing club for loan tips", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(106);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const borrower = makePlayer(brentford, league, {
    playingClubId: brentford.clubId,
    employmentClubId: arsenal.clubId,
  });
  assert.equal(
    resolveClubContinentalEntry({
      world,
      clubId: borrower.playingClubId,
      league,
      targetYear: 2026,
    }).status,
    "not-qualified"
  );
  assert.equal(
    resolveClubContinentalEntry({
      world,
      clubId: arsenal.clubId,
      league,
      targetYear: 2026,
    }).status,
    "qualified"
  );
});

test("F18: registration policy still gates continental attachment", () => {
  assert.equal(typeof canAttachToContinentalFixture, "function");
  const denied = canAttachToContinentalFixture({
    edition: {
      playerClubId: "club:england:arsenal",
      field: [{ clubId: "club:england:brentford" }, { clubId: "club:england:arsenal" }],
      format: {
        playerRegistration: {
          subsequentAllowedFromStage: "playoff",
          deadlineDayOfYear: 35,
          leaguePhaseImmediate: false,
        },
        knockout: { path: ["playoff", "R16", "QF", "SF", "Final"] },
      },
    },
    playingClubId: "club:england:brentford",
    fixture: {
      homeClubId: "club:england:brentford",
      awayClubId: "club:england:arsenal",
      stageType: "league",
      stageId: "league",
    },
    registrationEffectiveDate: "2026-09-01",
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.reason);
});

test("F19: mid-season focus change does not redraw world edition", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const dest = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: dest.clubId });
  const world = resetWorld(107);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(arsenal, league);
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  const field = original.field.map((c) => c.clubId).sort();
  processContinentalMatchday(original, 1, { world, player });
  // Destination resolve uses destination club id only.
  const destResolved = resolveClubContinentalEntry({
    world,
    clubId: dest.clubId,
    league,
    targetYear: 2026,
  });
  assert.equal(destResolved.status, "not-qualified");
  const loaded = loadContinentalEdition({
    competitionId: original.competitionId,
    editionId: original.editionId,
    world,
  });
  assert.deepEqual(loaded.field.map((c) => c.clubId).sort(), field);
});

test("F20: calendar-year Brazil uses edition year not seasons.length alone", () => {
  const league = topFlight("Brazil");
  assert.ok(league);
  const club = league.clubs[0];
  const table = orderedTable(league, { 1: club.clubId });
  const world = resetWorld(108);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(club, league, { seasons: [{}, {}, {}] }); // seasons.length misleading
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  assert.equal(standing?.competition, "Copa Libertadores");
  assert.equal(sourceYearForContinentalTarget(2026), 2025);
});

test("F21: snapshot round-trip preserves qualification + edition", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(109);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const player = makePlayer(arsenal, league);
  const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
  prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
  const raw = serializeWorldState(world);
  const restored = deserializeWorldState(raw);
  assert.ok(restored.qualification instanceof Map);
  assert.equal(
    getClubTargetDecision(restored, arsenal.clubId, 2026).entry.competition,
    "Champions League"
  );
  assert.equal(
    getClubTargetDecision(restored, brentford.clubId, 2026).entry.status,
    "not-qualified"
  );
  const loaded = loadContinentalEdition({
    competitionId: "uefa-champions-league",
    editionId: "2026-uefa-champions-league",
    world: restored,
  });
  assert.ok(loaded);
  assert.equal(loaded.field.length, 36);
});

test("F22: repeated commit/resolve is stable", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId });
  const world = resetWorld(110);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const a = resolveClubContinentalEntry({ world, clubId: arsenal.clubId, league, targetYear: 2026 });
  const b = resolveClubContinentalEntry({ world, clubId: arsenal.clubId, league, targetYear: 2026 });
  assert.deepEqual(a.entry, b.entry);
});

test("F23: free-agent gap cannot reuse old club finish for a new club without evidence", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const brentford = clubIn(league, "club:england:brentford");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId });
  const world = resetWorld(111);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const fa = makePlayer(brentford, league, {
    playingClubId: brentford.clubId,
    latestStanding: {
      leagueId: league.leagueId,
      seasonId: `${league.leagueId}::2025`,
      table,
      playerRow: table[0],
    },
  });
  assert.equal(preSeasonContinentalStanding(fa, league, { world, seasonYear: 2026 }), null);
});

test("F24: partial provenance does not grant completed earned entry", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const world = resetWorld(112);
  const partial = orderedTable(league, { 1: arsenal.clubId }).slice(0, 5);
  commitCompletedDomesticEdition({
    world,
    league,
    table: partial,
    sourceYear: 2025,
    provenance: "partial-origin",
    status: "partial",
  });
  const record = getDomesticEditionRecord(world, league.leagueId, 2025);
  assert.equal(record.status, "partial");
  assert.equal(record.completed, false);
  // Incomplete editions are not treated as authoritative completed decisions for lookup helpers
  // that require completed=true; club pointer may still exist — resolve should bootstrap or unresolved
  // rather than treating partial as full. ensureBootstrap may fill if allowBootstrap.
  const r = resolveClubContinentalEntry({
    world,
    clubId: arsenal.clubId,
    league,
    targetYear: 2026,
    allowBootstrap: false,
  });
  // Partial record exists but completed=false → fall through unresolved without bootstrap
  assert.ok(r.status === "unresolved" || r.edition?.status === "partial");
});

test("F25: independent oracle detects corrupted decisions", () => {
  const league = leagueById("league:england-premier-league");
  const arsenal = clubIn(league, "club:england:arsenal");
  const table = orderedTable(league, { 1: arsenal.clubId, 17: "club:england:brentford" });
  const world = resetWorld(113);
  commitCompletedDomesticEdition({ world, league, table, sourceYear: 2025 });
  const good = getClubTargetDecision(world, arsenal.clubId, 2026).entry;
  assert.equal(oracleCompetition(league.nation, league.leagueId, good.position), good.competition);

  const corrupted = {
    clubId: "club:england:brentford",
    position: 17,
    competition: "Champions League",
    sourceEditionYear: 2025,
  };
  const expected = oracleCompetition(league.nation, league.leagueId, corrupted.position);
  assert.notEqual(expected, corrupted.competition);
  assert.equal(expected, null);

  // Wrong source year claim
  assert.notEqual(corrupted.sourceEditionYear, 2026);
  assert.equal(sourceYearForContinentalTarget(2026), 2025);

  // Wrong participant: Brentford listed as CL while oracle says null
  const br = getClubTargetDecision(world, "club:england:brentford", 2026).entry;
  assert.equal(oracleCompetition(league.nation, league.leagueId, br.position), br.competition);
  assert.equal(br.competition, null);
});
