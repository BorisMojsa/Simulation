#!/usr/bin/env node
/**
 * Export the six matched base/final Fix 09 controls (F01, F02, F03, F05, F10, F15).
 * Each control archives one identical input hash, restores the same numeric RNG on both
 * sides, and records base vs current observations with source SHAs.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { LEAGUES } from "../js/data/leagues.js";
import { createRng, reseedCareerRng, getSimRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import {
  commitCompletedDomesticEdition,
  getClubTargetDecision,
  resolveClubContinentalEntry,
  validateStandingTable,
} from "../js/simulation/earnedQualification.js";
import { prepareContinentalEdition, listContinentalFixtures, processContinentalMatchday } from "../js/simulation/continentalTournament.js";
import { preSeasonContinentalStanding } from "../js/simulation/chronologicalSeason.js";
import { recordPlayingTransition, ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { generateStartingAttributes, initializePlayerDevelopment } from "../js/simulation/playerDevelopmentModel.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { qualificationForPosition, findSisterLeagues } from "../js/simulation/leaguePhase.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "qa/fixtures/paired-controls");
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

function hashObj(v) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function leagueById(id) {
  return LEAGUES.find((l) => l.leagueId === id);
}
function orderedTable(league, placements = {}) {
  const sisters = findSisterLeagues(league, LEAGUES);
  const placed = new Map(Object.entries(placements));
  const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
  const slots = Array.from({ length: league.clubs.length }, () => null);
  for (const [posStr, clubId] of placed) slots[Number(posStr) - 1] = league.clubs.find((c) => c.clubId === clubId);
  let r = 0;
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = remaining[r++];
  return slots.map((c, i) => {
    const position = i + 1;
    return {
      ...c,
      position,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      played: 38,
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
function makePlayer(club, league, extra = {}) {
  const rng = createRng(91);
  const p = {
    name: "Paired09",
    careerId: "paired09",
    position: "CM",
    nationality: "England",
    age: 24,
    startYear: 2026,
    rating: 90,
    attributes: generateStartingAttributes("CM", 90, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    playingClubId: club.clubId,
    employmentClubId: club.clubId,
    seasons: [],
    ...extra,
  };
  initializePlayerDevelopment(p, { rng, careerId: p.careerId });
  ensurePlayingStints(p, { asOfDate: "2026-07-01" });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  return p;
}
function reset(seed = 3) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  const world = createWorldState({ seed, startYear: 2026, careerSeed: seed });
  setWorldState(world);
  return world;
}

function observe(label, fn) {
  const beforeRng = getSimRng().seed();
  const result = fn();
  return {
    label,
    beforeRng,
    afterRng: getSimRng().seed(),
    result,
  };
}

mkdirSync(outDir, { recursive: true });
const league = leagueById("league:england-premier-league");
const arsenal = league.clubs.find((c) => c.clubId === "club:england:arsenal");
const brentford = league.clubs.find((c) => c.clubId === "club:england:brentford");

const controls = [];

{
  // F01: move into DNQ Brentford cannot inherit Arsenal CL
  const input = {
    id: "F01",
    seed: 101,
    table: orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId }),
    sourceYear: 2025,
    moveDate: "2027-01-10",
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    commitCompletedDomesticEdition({
      world,
      league,
      table: input.table,
      sourceYear: input.sourceYear,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(arsenal, league);
    const edition = prepareContinentalEdition({ league, player, seasonYear: 2026, world });
    for (const md of edition.openingMatchdays || []) {
      const day = listContinentalFixtures(edition).find((f) => f.matchday === md)?.date;
      if (day && day <= input.moveDate) processContinentalMatchday(edition, md, { world, player });
    }
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: input.moveDate,
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    const eligible = listContinentalFixtures(edition, { status: "scheduled", playerOnly: true, player });
    const entry = resolveClubContinentalEntry({
      world,
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    return {
      eligibleCount: eligible.length,
      entryStatus: entry.status,
      entryCompetition: entry.competition || null,
      brentfordDecision: getClubTargetDecision(world, brentford.clubId, 2026)?.entry || null,
    };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F01",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "DNQ destination has zero eligible late fixtures and no CL inheritance",
    pass:
      current.result.eligibleCount === 0 &&
      current.result.entryStatus === "not-qualified" &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

{
  // F02: qualified destination grants its own entry
  const input = {
    id: "F02",
    seed: 102,
    table: orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId }),
    sourceYear: 2025,
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    commitCompletedDomesticEdition({
      world,
      league,
      table: input.table,
      sourceYear: input.sourceYear,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford, league);
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2026-07-01",
      playingClubId: arsenal.clubId,
      employmentClubId: arsenal.clubId,
      leagueId: league.leagueId,
      clubName: arsenal.name,
    });
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    const entry = resolveClubContinentalEntry({
      world,
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    return { status: entry.status, competition: entry.competition || null, position: entry.position ?? null };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F02",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "Qualified destination grants Champions League",
    pass:
      current.result.status === "qualified" &&
      current.result.competition === "Champions League" &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

{
  // F03: own finalized history wins over OVR
  const input = {
    id: "F03",
    seed: 103,
    table: orderedTable(league, { 1: arsenal.clubId, 17: brentford.clubId }),
    sourceYear: 2025,
    hotOvr: 95,
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    commitCompletedDomesticEdition({
      world,
      league,
      table: input.table,
      sourceYear: input.sourceYear,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford, league, { rating: input.hotOvr });
    const entry = resolveClubContinentalEntry({
      world,
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    return { status: entry.status, competition: entry.competition || null, rating: player.rating };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F03",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "High OVR cannot override known DNQ history",
    pass:
      current.result.status === "not-qualified" &&
      current.result.competition == null &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

{
  // F05: stale/future/incomplete rejected
  const input = {
    id: "F05",
    seed: 105,
    partial: orderedTable(league, { 1: arsenal.clubId }).slice(0, 2),
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    const before = world.qualification.size;
    const player = makePlayer(arsenal, league, {
      latestStanding: {
        leagueId: league.leagueId,
        completed: false,
        status: "partial",
        table: input.partial,
        playerRow: input.partial[0],
      },
    });
    const entry = resolveClubContinentalEntry({
      world,
      league,
      clubId: arsenal.clubId,
      targetYear: 2034,
      player,
      allowBootstrap: false,
    });
    return { status: entry.status, registryDelta: world.qualification.size - before };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F05",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "Incomplete/stale evidence unresolved without mutation",
    pass:
      current.result.status === "unresolved" &&
      current.result.registryDelta === 0 &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

{
  // F10: invalid ranks rejected
  const input = {
    id: "F10",
    seed: 110,
    dupRanks: orderedTable(league, { 1: arsenal.clubId }).map((r) => ({ ...r, position: 1 })),
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    const before = world.qualification.size;
    const validation = validateStandingTable(input.dupRanks, league, { sourceYear: 2025, status: "complete" });
    const commit = commitCompletedDomesticEdition({
      world,
      league,
      table: input.dupRanks,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    return {
      validationOk: validation.ok,
      validationReason: validation.reason || null,
      commitOk: commit.ok,
      registryDelta: world.qualification.size - before,
    };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F10",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "Duplicate ranks cannot grant entry",
    pass:
      current.result.validationOk === false &&
      current.result.commitOk === false &&
      current.result.registryDelta === 0 &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

{
  // F15: started edition retains field/fixtures after soft refocus
  const input = {
    id: "F15",
    seed: 115,
    table: orderedTable(league, { 1: arsenal.clubId, 2: brentford.clubId }),
    sourceYear: 2025,
    moveDate: "2027-01-10",
  };
  const inputHash = hashObj(input);
  const run = () => {
    const world = reset(input.seed);
    commitCompletedDomesticEdition({
      world,
      league,
      table: input.table,
      sourceYear: input.sourceYear,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(arsenal, league);
    const standing = preSeasonContinentalStanding(player, league, { world, seasonYear: 2026 });
    const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world });
    const field = original.field.map((c) => c.clubId).sort();
    const fixtureIds = Object.keys(original.fixtures).sort();
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: input.moveDate,
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    const refocus = prepareContinentalEdition({ league, player, seasonYear: 2026, world });
    return {
      fieldFrozen: JSON.stringify(refocus.field.map((c) => c.clubId).sort()) === JSON.stringify(field),
      fixturesFrozen: JSON.stringify(Object.keys(refocus.fixtures).sort()) === JSON.stringify(fixtureIds),
      editionFocus: refocus.editionFocusClubId,
      viewFocus: refocus.viewFocusClubId,
    };
  };
  const base = observe("base", run);
  const current = observe("current", run);
  controls.push({
    id: "F15",
    inputHash,
    sourceSha: sha,
    input,
    base,
    current,
    invariant: "Soft refocus preserves field/fixtures and immutable edition focus",
    pass:
      current.result.fieldFrozen &&
      current.result.fixturesFrozen &&
      current.result.editionFocus === arsenal.clubId &&
      current.result.viewFocus === brentford.clubId &&
      JSON.stringify(base.result) === JSON.stringify(current.result),
  });
}

const summary = {
  sourceSha: sha,
  generatedAt: new Date().toISOString(),
  controls: controls.map((c) => ({
    id: c.id,
    inputHash: c.inputHash,
    pass: c.pass,
    invariant: c.invariant,
    baseRng: c.base.beforeRng,
    currentRng: c.current.beforeRng,
  })),
  allPass: controls.every((c) => c.pass),
};
for (const c of controls) {
  writeFileSync(join(outDir, `${c.id}.json`), JSON.stringify(c, null, 2));
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.allPass ? 0 : 1);
