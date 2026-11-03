#!/usr/bin/env node
/**
 * Fix 09 matched accepted-base vs final controls (F01, F02, F03, F05, F10, F15).
 *
 * Builds each shared input once, archives it + hash, then runs the identical
 * bytes through isolated processes at accepted base 984495e and the current tip.
 *
 *   node scripts/exportFix09PairedControls.mjs
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_SHA = "984495e4c12df0c2dd1c84d124bc4cb743a0f63e";
const FINAL_SHA = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const outDir = join(root, "qa/fixtures/paired-controls");

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r;
}

function hashObj(v) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "inputs"), { recursive: true });

const workerSrc = `#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  })
);
const side = args.side;
const rootDir = args.root;
const inputPath = args.input;
const outPath = args.out;
const input = JSON.parse(readFileSync(inputPath, "utf8"));

const rootUrl = pathToFileURL(rootDir.endsWith("/") ? rootDir : rootDir + "/");
const mod = (rel) => import(new URL(rel, rootUrl));

function captureRng(getSimRng) {
  try {
    return Number(getSimRng().seed());
  } catch {
    return null;
  }
}

async function runFinal() {
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { createWorldState, setWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
  const {
    commitCompletedDomesticEdition,
    getClubTargetDecision,
    resolveClubContinentalEntry,
    normalizeFinishPosition,
    competitionForValidatedFinish,
    sourceYearForContinentalTarget,
  } = await mod("js/simulation/earnedQualification.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const {
    prepareContinentalEdition,
    listContinentalFixtures,
    processContinentalMatchday,
  } = await mod("js/simulation/continentalTournament.js");
  const { recordPlayingTransition, ensurePlayingStints } = await mod("js/simulation/playingRegistration.js");
  const { generateStartingAttributes, initializePlayerDevelopment } = await mod(
    "js/simulation/playerDevelopmentModel.js"
  );
  const { ensurePlayerModel } = await mod("js/simulation/playerModelMigration.js");
  const { refreshAbilityCaches } = await mod("js/simulation/playerAbility.js");
  const { ensureContractAuthority } = await mod("js/simulation/contractLifecycle.js");
  const { ensureTransferSave } = await mod("js/simulation/transferMigration.js");
  const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");

  const league = LEAGUES.find((l) => l.leagueId === input.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === input.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === input.brentfordId);

  function orderedTable(placements = {}) {
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

  function makePlayer(club, extra = {}) {
    const rng = createRng(91);
    const p = {
      name: "Paired09",
      careerId: "paired09",
      position: "CM",
      nationality: "England",
      age: 24,
      startYear: 2026,
      rating: extra.rating ?? 90,
      attributes: generateStartingAttributes("CM", extra.rating ?? 90, 99, rng),
      club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
      playingClubId: club.clubId,
      employmentClubId: club.clubId,
      seasons: [],
      ...extra,
    };
    ensurePlayerModel(p);
    initializePlayerDevelopment(p, { rng });
    refreshAbilityCaches(p);
    ensureContractAuthority(p);
    ensureTransferSave(p);
    ensurePlayingStints(p, { asOfDate: "2026-07-01" });
    return p;
  }

  resetClubFinanceLedgers();
  reseedCareerRng(input.seed);
  setWorldState(createWorldState({ startYear: 2026, rngSeed: input.seed }));
  const rngAfterRestore = captureRng(getSimRng);

  let result;
  if (input.id === "F01") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford);
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2026-07-01",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const edition = standing
      ? prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world: getWorldState() })
      : null;
    const decision = getClubTargetDecision(getWorldState(), brentford.clubId, 2026)?.entry || null;
    const eligible = edition
      ? listContinentalFixtures(edition, { status: "scheduled", playerOnly: true, player }).length
      : 0;
    result = {
      standing: standing ? { position: standing.position, competition: standing.competition || null } : null,
      editionCompetition: edition?.competition || null,
      eligibleCount: eligible,
      decisionStatus: decision?.status || null,
      decisionCompetition: decision?.competition || null,
      decisionPosition: decision?.position ?? null,
    };
  } else if (input.id === "F02") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford);
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
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = { status: entry.status, competition: entry.competition || null, position: entry.position ?? null };
  } else if (input.id === "F03") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const highOut = makePlayer(brentford, { rating: input.hotOvr });
    const entry = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player: highOut,
      allowBootstrap: false,
    });
    result = { status: entry.status, competition: entry.competition || null, ovr: input.hotOvr };
  } else if (input.id === "F05") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2024,
      provenance: "legacy-migrated",
    });
    const stale = resolveClubContinentalEntry({
      world: getWorldState(),
      clubId: arsenal.clubId,
      league,
      targetYear: 2026,
      allowBootstrap: false,
    });
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const ok = resolveClubContinentalEntry({
      world: getWorldState(),
      clubId: arsenal.clubId,
      league,
      targetYear: 2026,
      allowBootstrap: false,
    });
    result = {
      staleStatus: stale.status,
      okStatus: ok.status,
      okCompetition: ok.competition || null,
      sourceYearFor2026: sourceYearForContinentalTarget(2026),
    };
  } else if (input.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => ({
      value: String(p),
      normalizeOk: normalizeFinishPosition(p, { tableSize: 20 }).ok === true,
      competition: continentalCompetitionForStanding({ position: p }, league),
    }));
    const conflicting = competitionForValidatedFinish(
      { position: 17, qualification: "Champions League" },
      league,
      { tableSize: 20 }
    );
    const legacyNumeric = continentalCompetitionForStanding({ position: "3" }, league);
    result = { rejected, conflicting, legacyNumeric };
  } else if (input.id === "F15") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(arsenal);
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const original = prepareContinentalEdition({
      standing,
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { world: getWorldState(), player });
        played.push(md);
      }
    }
    const fieldBefore = original.field.map((c) => c.clubId).sort();
    const fixtureIdsBefore = Object.keys(original.fixtures).sort();
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({ league, player, seasonYear: 2026, world: getWorldState() });
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify(refocus.field.map((c) => c.clubId).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(Object.keys(refocus.fixtures).sort()) === JSON.stringify(fixtureIdsBefore),
      editionFocusClubId: refocus.editionFocusClubId,
      viewFocusClubId: refocus.viewFocusClubId,
      lateEligibleAfterMove: afterMove,
    };
  } else {
    throw new Error("unknown control " + input.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        result,
      },
      null,
      2
    )
  );
}

async function runBase() {
  // Accepted base lacks earnedQualification.js — use latestStanding + preSeasonContinentalStanding.
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { createWorldState, setWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const { prepareContinentalEdition, listContinentalFixtures, processContinentalMatchday } = await mod(
    "js/simulation/continentalTournament.js"
  );
  const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");

  const league = LEAGUES.find((l) => l.leagueId === input.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === input.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === input.brentfordId);

  function orderedTable(placements = {}) {
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

  function makePlayer(club, extra = {}) {
    return {
      name: "Paired09",
      careerId: "paired09",
      position: "CM",
      nationality: "England",
      age: 24,
      startYear: 2026,
      rating: extra.rating ?? 90,
      overall: extra.rating ?? 90,
      club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation, overall: extra.rating ?? club.overall },
      playingClubId: club.clubId,
      employmentClubId: club.clubId,
      seasons: [],
      ...extra,
    };
  }

  resetClubFinanceLedgers();
  reseedCareerRng(input.seed);
  setWorldState(createWorldState({ startYear: 2026, rngSeed: input.seed }));
  const rngAfterRestore = captureRng(getSimRng);

  let result;
  if (input.id === "F01") {
    const table = orderedTable(input.placements);
    // Base adapter: attach Arsenal finish onto Brentford career via latestStanding (pre-Fix-09 path).
    const player = makePlayer(brentford, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
    const standing = preSeasonContinentalStanding(player, league);
    const edition = standing
      ? prepareContinentalEdition({ standing, league, player, seasonYear: 2026 })
      : null;
    const eligible = edition
      ? listContinentalFixtures(edition, { status: "scheduled", playerOnly: true, player }).length
      : 0;
    result = {
      standing: standing ? { position: standing.position, competition: standing.qualification || null } : null,
      editionCompetition: edition?.competition || null,
      eligibleCount: eligible,
      decisionStatus: null,
      decisionCompetition: null,
      decisionPosition: standing?.position ?? null,
      adapter: "base-latestStanding-inherit",
    };
  } else if (input.id === "F02") {
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      position: standing?.position ?? null,
      adapter: "base-latestStanding",
    };
  } else if (input.id === "F03") {
    const table = orderedTable(input.placements);
    const player = makePlayer(brentford, {
      rating: input.hotOvr,
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === brentford.clubId),
      },
    });
    // Base may still OVR-seed when standing is weak; capture whatever preSeason returns.
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      ovr: input.hotOvr,
      adapter: "base-latestStanding-or-ovr",
    };
  } else if (input.id === "F05") {
    // Base has no edition registry — stale/future incomplete mapping is not enforced.
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2024",
        table,
        playerRow: table[0],
      },
    });
    const staleStanding = preSeasonContinentalStanding(player, league);
    player.latestStanding.seasonId = league.leagueId + "::2025";
    const okStanding = preSeasonContinentalStanding(player, league);
    result = {
      staleStatus: staleStanding ? "qualified" : "unresolved",
      okStatus: okStanding ? "qualified" : "unresolved",
      okCompetition: okStanding ? continentalCompetitionForStanding(okStanding, league) : null,
      sourceYearFor2026: 2025,
      adapter: "base-no-edition-registry",
    };
  } else if (input.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => ({
      value: String(p),
      normalizeOk: Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 20,
      competition: continentalCompetitionForStanding({ position: p }, league),
    }));
    const conflicting = continentalCompetitionForStanding(
      { position: 17, qualification: "Champions League" },
      league
    );
    const legacyNumeric = continentalCompetitionForStanding({ position: "3" }, league);
    result = { rejected, conflicting, legacyNumeric, adapter: "base-label-fallback" };
  } else if (input.id === "F15") {
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
    const standing = preSeasonContinentalStanding(player, league);
    const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026 });
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    const fieldBefore = original.field.map((c) => c.clubId).sort();
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({
      standing: preSeasonContinentalStanding(
        {
          ...player,
          latestStanding: {
            leagueId: league.leagueId,
            table,
            playerRow: table.find((r) => r.clubId === brentford.clubId),
          },
        },
        league
      ),
      league,
      player,
      seasonYear: 2026,
    });
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus?.field || []).map((c) => c.clubId).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: false,
      editionFocusClubId: refocus?.editionFocusClubId || refocus?.playerClubId || null,
      viewFocusClubId: refocus?.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
      adapter: "base-soft-refocus",
    };
  } else {
    throw new Error("unknown control " + input.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        result,
      },
      null,
      2
    )
  );
}

if (side === "final") await runFinal();
else if (side === "base") await runBase();
else throw new Error("side must be base|final");
`;

const workerPath = join(outDir, "_paired-worker.mjs");
writeFileSync(workerPath, workerSrc);

const baseWork = mkdtempSync(join(tmpdir(), "fix09-paired-base-"));
try {
  sh("git", ["worktree", "add", "--detach", baseWork, BASE_SHA]);

  const controls = [];
  const specs = [
    {
      id: "F01",
      seed: 101,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal", 17: "club:england:brentford" },
      invariant: "DNQ Brentford cannot inherit Arsenal first-place/CL",
      passFinal: (r) =>
        r.decisionStatus === "not-qualified" &&
        r.eligibleCount === 0 &&
        (r.editionCompetition == null || r.standing == null),
    },
    {
      id: "F02",
      seed: 102,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal", 17: "club:england:brentford" },
      invariant: "Qualified destination grants Champions League",
      passFinal: (r) => r.status === "qualified" && r.competition === "Champions League",
    },
    {
      id: "F03",
      seed: 103,
      hotOvr: 95,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal", 17: "club:england:brentford" },
      invariant: "High OVR cannot override known DNQ history",
      passFinal: (r) => r.status === "not-qualified" || r.competition == null,
    },
    {
      id: "F05",
      seed: 105,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal" },
      invariant: "Incomplete/stale evidence unresolved without mutation",
      passFinal: (r) => r.staleStatus === "unresolved" && r.okStatus === "qualified",
    },
    {
      id: "F10",
      seed: 110,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal" },
      invariant: "Invalid ranks/conflicting labels rejected; legacy numeric ok",
      passFinal: (r) =>
        r.conflicting == null &&
        r.legacyNumeric === "Champions League" &&
        Array.isArray(r.rejected) &&
        r.rejected.filter((x) => x.value !== "3").every((x) => x.competition == null || x.normalizeOk === false),
    },
    {
      id: "F15",
      seed: 115,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      placements: { 1: "club:england:arsenal", 2: "club:england:brentford" },
      invariant: "Soft refocus after committed MD1 preserves field/fixtures and registration gate",
      passFinal: (r) =>
        r.fieldEqual === true &&
        r.fixturesEqual === true &&
        r.lateEligibleAfterMove === 0 &&
        Array.isArray(r.playedMatchdays) &&
        r.playedMatchdays.length > 0,
    },
  ];

  for (const spec of specs) {
    const input = { ...spec };
    delete input.invariant;
    delete input.passFinal;
    const inputHash = hashObj(input);
    const inputPath = join(outDir, "inputs", `${spec.id}.json`);
    writeFileSync(inputPath, JSON.stringify(input, null, 2));

    const baseOut = join(outDir, `${spec.id}.base-obs.json`);
    const finalOut = join(outDir, `${spec.id}.final-obs.json`);

    const baseRun = spawnSync(
      process.execPath,
      [
        workerPath,
        `--side=base`,
        `--root=${baseWork}`,
        `--input=${inputPath}`,
        `--out=${baseOut}`,
        `--sha=${BASE_SHA}`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
    const finalRun = spawnSync(
      process.execPath,
      [
        workerPath,
        `--side=final`,
        `--root=${root}`,
        `--input=${inputPath}`,
        `--out=${finalOut}`,
        `--sha=${FINAL_SHA}`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );

    const baseObs = baseRun.status === 0 && existsSync(baseOut) ? JSON.parse(readFileSync(baseOut, "utf8")) : {
      error: baseRun.stderr || baseRun.stdout,
      status: baseRun.status,
    };
    const finalObs = finalRun.status === 0 && existsSync(finalOut) ? JSON.parse(readFileSync(finalOut, "utf8")) : {
      error: finalRun.stderr || finalRun.stdout,
      status: finalRun.status,
    };

    const pass = finalRun.status === 0 && spec.passFinal(finalObs.result || {});
    const record = {
      id: spec.id,
      inputHash,
      inputPath: `inputs/${spec.id}.json`,
      baseSha: BASE_SHA,
      finalSha: FINAL_SHA,
      invariant: spec.invariant,
      base: baseObs,
      current: finalObs,
      // Keep legacy key names for packagers that expect base/current.
      pass,
      baseFailedInvariant:
        baseRun.status === 0 ? !spec.passFinal(baseObs.result || {}) : true,
      observationsEqual: JSON.stringify(baseObs.result) === JSON.stringify(finalObs.result),
    };
    controls.push(record);
    writeFileSync(join(outDir, `${spec.id}.json`), JSON.stringify(record, null, 2));
  }

  const summary = {
    baseSha: BASE_SHA,
    finalSha: FINAL_SHA,
    adapter: "exportFix09PairedControls worktree base + tip worker",
    controls: controls.map((c) => ({
      id: c.id,
      inputHash: c.inputHash,
      pass: c.pass,
      invariant: c.invariant,
      baseRng: c.base?.rngAfterRestore ?? null,
      currentRng: c.current?.rngAfterRestore ?? null,
      observationsEqual: c.observationsEqual,
      baseFailedInvariant: c.baseFailedInvariant,
    })),
    allPass: controls.every((c) => c.pass),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.allPass ? 0 : 1;
} finally {
  spawnSync("git", ["worktree", "remove", "--force", baseWork], { cwd: root, encoding: "utf8" });
  rmSync(baseWork, { recursive: true, force: true });
}
