#!/usr/bin/env node
/**
 * Fix 09 matched accepted-base vs final controls (F01, F02, F03, F05, F10, F15).
 *
 * Builds each common complete player/world/finance/RNG input once on the tip,
 * archives it + byte hash, then restores those exact bytes in isolated workers
 * at accepted base 984495e and the current tip.
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

function hashBytes(s) {
  return createHash("sha256").update(s).digest("hex");
}

function hashObj(v) {
  return hashBytes(JSON.stringify(v));
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "inputs"), { recursive: true });

// ── Prepare shared full inputs on the tip ───────────────────────────────────
const prepSrc = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  })
);
const rootDir = args.root;
const inputPath = args.input;
const outPath = args.out;
const recipe = JSON.parse(await (await import("node:fs")).promises.readFile(inputPath, "utf8"));
const rootUrl = pathToFileURL(rootDir.endsWith("/") ? rootDir : rootDir + "/");
const mod = (rel) => import(new URL(rel, rootUrl));

const { LEAGUES } = await mod("js/data/leagues.js");
const { createWorldState, setWorldState, getWorldState, serializeWorldState } = await mod(
  "js/simulation/worldState.js"
);
const { resetClubFinanceLedgers, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
const {
  commitCompletedDomesticEdition,
} = await mod("js/simulation/earnedQualification.js");
const { recordPlayingTransition, ensurePlayingStints } = await mod("js/simulation/playingRegistration.js");
const { generateStartingAttributes, initializePlayerDevelopment } = await mod(
  "js/simulation/playerDevelopmentModel.js"
);
const { ensurePlayerModel } = await mod("js/simulation/playerModelMigration.js");
const { refreshAbilityCaches } = await mod("js/simulation/playerAbility.js");
const { ensureContractAuthority } = await mod("js/simulation/contractLifecycle.js");
const { ensureTransferSave } = await mod("js/simulation/transferMigration.js");
const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");

const league = LEAGUES.find((l) => l.leagueId === recipe.leagueId);
const arsenal = league.clubs.find((c) => c.clubId === recipe.arsenalId);
const brentford = league.clubs.find((c) => c.clubId === recipe.brentfordId);

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

resetClubFinanceLedgers();
reseedCareerRng(recipe.seed);
setWorldState(createWorldState({ seed: recipe.seed, startYear: 2026 }));
const rngAfterCreate = Number(getSimRng().seed());
if (rngAfterCreate !== Number(recipe.seed) && Number(getWorldState().rngSeed) !== Number(recipe.seed)) {
  // createWorldState({seed}) must install that seed as career rngSeed.
  throw new Error("createWorldState ignored seed: got " + getWorldState().rngSeed);
}

const table = orderedTable(recipe.placements);
const sourceYear = recipe.sourceYear ?? 2025;
// F05 archives a stale 2024 commit only; the final worker adds the correct 2025 mapping.
const commitYear = recipe.id === "F05" ? 2024 : sourceYear;
commitCompletedDomesticEdition({
  world: getWorldState(),
  league,
  table,
  sourceYear: commitYear,
  provenance: recipe.provenance || "legacy-migrated",
});

const homeClub =
  recipe.playerClubId === recipe.brentfordId
    ? brentford
    : recipe.playerClubId === recipe.arsenalId
      ? arsenal
      : league.clubs.find((c) => c.clubId === recipe.playerClubId) || brentford;

const rng = createRng(91);
const rating = recipe.rating ?? recipe.hotOvr ?? 90;
const player = {
  name: "Paired09",
  careerId: "paired09",
  position: "CM",
  nationality: "England",
  age: 24,
  startYear: 2026,
  rating,
  attributes: generateStartingAttributes("CM", rating, 99, rng),
  club: { ...homeClub, league: league.name, leagueId: league.leagueId, nation: league.nation },
  playingClubId: homeClub.clubId,
  employmentClubId: homeClub.clubId,
  seasons: [],
};
ensurePlayerModel(player);
initializePlayerDevelopment(player, { rng });
refreshAbilityCaches(player);
ensureContractAuthority(player);
ensureTransferSave(player);
ensurePlayingStints(player, { asOfDate: "2026-07-01" });

// Shared stale Arsenal first-place row for F01 (both workers must see the same evidence).
const arsenalRow = table.find((r) => r.clubId === arsenal.clubId);
const brentfordRow = table.find((r) => r.clubId === brentford.clubId);
if (recipe.id === "F01") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: arsenalRow,
  };
  recordPlayingTransition(player, {
    kind: "permanent",
    effectiveDate: "2026-07-01",
    playingClubId: brentford.clubId,
    employmentClubId: brentford.clubId,
    leagueId: league.leagueId,
    clubName: brentford.name,
  });
} else if (recipe.id === "F02" || recipe.id === "F15") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: arsenalRow,
  };
} else if (recipe.id === "F03") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: brentfordRow,
  };
} else if (recipe.id === "F05") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::2024",
    table,
    playerRow: table[0],
  };
}

const world = getWorldState();
world.rngState = getSimRng().seed();
const shared = {
  id: recipe.id,
  seed: recipe.seed,
  leagueId: recipe.leagueId,
  arsenalId: recipe.arsenalId,
  brentfordId: recipe.brentfordId,
  placements: recipe.placements,
  sourceYear,
  rating,
  hotOvr: recipe.hotOvr ?? null,
  playerClubId: homeClub.clubId,
  table,
  arsenalRow,
  brentfordRow,
  player: structuredClone(player),
  world: serializeWorldState(world),
  clubFinance: exportClubFinanceState(),
  expectedRngAfterRestore: Number(getSimRng().seed()),
  worldRngSeed: Number(world.rngSeed),
  worldRngState: Number(world.rngState),
};
writeFileSync(outPath, JSON.stringify(shared));
console.log(JSON.stringify({ id: recipe.id, expectedRngAfterRestore: shared.expectedRngAfterRestore }));
`;

const workerSrc = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
const shared = JSON.parse(readFileSync(inputPath, "utf8"));
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
  const { setWorldState, deserializeWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { importClubFinanceState, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng, setSimRng } = await mod("js/simulation/rng.js");
  const {
    getClubTargetDecision,
    resolveClubContinentalEntry,
    normalizeFinishPosition,
    competitionForValidatedFinish,
    sourceYearForContinentalTarget,
    commitCompletedDomesticEdition,
  } = await mod("js/simulation/earnedQualification.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const {
    prepareContinentalEdition,
    listContinentalFixtures,
    processContinentalMatchday,
  } = await mod("js/simulation/continentalTournament.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");
  const { recordPlayingTransition } = await mod("js/simulation/playingRegistration.js");

  const league = LEAGUES.find((l) => l.leagueId === shared.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === shared.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === shared.brentfordId);

  importClubFinanceState(structuredClone(shared.clubFinance));
  const world = deserializeWorldState(structuredClone(shared.world));
  setWorldState(world);
  reseedCareerRng(shared.worldRngSeed);
  const rng = createRng(shared.worldRngSeed);
  rng.setSeed(shared.expectedRngAfterRestore);
  setSimRng(rng);
  world.rngState = shared.expectedRngAfterRestore;
  const rngAfterRestore = captureRng(getSimRng);
  if (rngAfterRestore !== shared.expectedRngAfterRestore) {
    throw new Error(
      "final RNG restore mismatch: got " + rngAfterRestore + " expected " + shared.expectedRngAfterRestore
    );
  }

  const player = structuredClone(shared.player);
  let result;
  if (shared.id === "F01") {
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
      staleArsenalRowPosition: player.latestStanding?.playerRow?.position ?? null,
      staleArsenalRowClubId: player.latestStanding?.playerRow?.clubId ?? null,
    };
  } else if (shared.id === "F02") {
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
  } else if (shared.id === "F03") {
    const entry = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = {
      status: entry.status,
      competition: entry.competition || null,
      ovr: shared.hotOvr,
    };
  } else if (shared.id === "F05") {
    const stale = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    // Commit the correct source year from the shared table (same bytes both sides use).
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table: shared.table,
      sourceYear: shared.sourceYear || 2025,
      provenance: "legacy-migrated",
    });
    const ok = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = {
      staleStatus: stale.status === "qualified" ? "qualified" : "unresolved",
      okStatus: ok.status,
      okCompetition: ok.competition || null,
      sourceYearFor2026: sourceYearForContinentalTarget(2026),
    };
  } else if (shared.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => {
      const n = normalizeFinishPosition(p, { tableSize: league.clubs.length });
      return {
        value: String(p),
        normalizeOk: Boolean(n?.ok),
        competition: n?.ok
          ? competitionForValidatedFinish({ position: n.position }, league, {
              tableSize: league.clubs.length,
            })
          : null,
      };
    });
    const conflicting = competitionForValidatedFinish(
      { position: 17, qualification: "Champions League" },
      league,
      { tableSize: league.clubs.length }
    );
    const legacy = normalizeFinishPosition("3", { tableSize: league.clubs.length });
    const legacyNumeric = legacy.ok
      ? competitionForValidatedFinish({ position: legacy.position }, league, {
          tableSize: league.clubs.length,
        })
      : null;
    result = { rejected, conflicting, legacyNumeric };
  } else if (shared.id === "F15") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const original = prepareContinentalEdition({
      standing,
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const fixtureIdsBefore = Object.keys(original.fixtures || {}).sort();
    const fieldBefore = (original.field || []).map((c) => c.clubId || c).sort();
    const scoresBefore = {};
    for (const id of fixtureIdsBefore) {
      const f = original.fixtures[id];
      scoresBefore[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({
      standing: preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 }),
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const fixtureIdsAfter = Object.keys(refocus.fixtures || {}).sort();
    const scoresAfter = {};
    for (const id of fixtureIdsAfter) {
      const f = refocus.fixtures[id];
      scoresAfter[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus.field || []).map((c) => c.clubId || c).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(fixtureIdsAfter) === JSON.stringify(fixtureIdsBefore),
      scoresEqual: JSON.stringify(scoresAfter) === JSON.stringify(scoresBefore),
      fixtureIdsBefore,
      fixtureIdsAfter,
      editionFocusClubId: refocus.editionFocusClubId || refocus.playerClubId || null,
      viewFocusClubId: refocus.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
    };
  } else {
    throw new Error("unknown control " + shared.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        expectedRngAfterRestore: shared.expectedRngAfterRestore,
        rngMatchesExpected: rngAfterRestore === shared.expectedRngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        inputHash: args.inputHash,
        result,
      },
      null,
      2
    )
  );
}

async function runBase() {
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { createWorldState, setWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers, importClubFinanceState, exportClubFinanceState } = await mod(
    "js/simulation/clubFinance.js"
  );
  const { createRng, reseedCareerRng, getSimRng, setSimRng } = await mod("js/simulation/rng.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const { prepareContinentalEdition, listContinentalFixtures, processContinentalMatchday } = await mod(
    "js/simulation/continentalTournament.js"
  );
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");
  const { recordPlayingTransition } = await mod("js/simulation/playingRegistration.js");

  const league = LEAGUES.find((l) => l.leagueId === shared.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === shared.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === shared.brentfordId);

  resetClubFinanceLedgers();
  if (shared.clubFinance) importClubFinanceState(structuredClone(shared.clubFinance));
  // Deterministic world create, then restore archived runtime RNG state.
  setWorldState(createWorldState({ seed: shared.seed, startYear: 2026 }));
  reseedCareerRng(shared.worldRngSeed ?? shared.seed);
  const rng = createRng(shared.worldRngSeed ?? shared.seed);
  rng.setSeed(shared.expectedRngAfterRestore);
  setSimRng(rng);
  getWorldState().rngSeed = shared.worldRngSeed ?? shared.seed;
  getWorldState().rngState = shared.expectedRngAfterRestore;
  const rngAfterRestore = captureRng(getSimRng);
  if (rngAfterRestore !== shared.expectedRngAfterRestore) {
    throw new Error(
      "base RNG restore mismatch: got " + rngAfterRestore + " expected " + shared.expectedRngAfterRestore
    );
  }

  // Same underlying player bytes as final (adapter only attaches base-era standing usage).
  const player = structuredClone(shared.player);
  const table = shared.table;

  let result;
  if (shared.id === "F01") {
    // Preserve the shared stale Arsenal row exactly.
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
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
      staleArsenalRowPosition: player.latestStanding?.playerRow?.position ?? null,
      staleArsenalRowClubId: player.latestStanding?.playerRow?.clubId ?? null,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F02") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      position: standing?.position ?? null,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F03") {
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.brentfordRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      ovr: shared.hotOvr,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F05") {
    // Shared world has only the 2024 commit; base has no edition registry target-year gate.
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::2024",
      table,
      playerRow: table[0],
    };
    const staleStanding = preSeasonContinentalStanding(player, league);
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const okStanding = preSeasonContinentalStanding(player, league);
    result = {
      staleStatus: staleStanding ? "qualified" : "unresolved",
      okStatus: okStanding ? "qualified" : "unresolved",
      okCompetition: okStanding ? continentalCompetitionForStanding(okStanding, league) : null,
      sourceYearFor2026: 2025,
      adapter: "base-latestStanding-year-switch",
    };
  } else if (shared.id === "F10") {
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
  } else if (shared.id === "F15") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026 });
    const fixtureIdsBefore = Object.keys(original.fixtures || {}).sort();
    const fieldBefore = (original.field || []).map((c) => c.clubId || c).sort();
    const scoresBefore = {};
    for (const id of fixtureIdsBefore) {
      const f = original.fixtures[id];
      scoresBefore[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
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
            playerRow: shared.brentfordRow,
          },
        },
        league
      ),
      league,
      player,
      seasonYear: 2026,
    });
    const fixtureIdsAfter = Object.keys(refocus?.fixtures || {}).sort();
    const scoresAfter = {};
    for (const id of fixtureIdsAfter) {
      const f = refocus.fixtures[id];
      scoresAfter[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus?.field || []).map((c) => c.clubId || c).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(fixtureIdsAfter) === JSON.stringify(fixtureIdsBefore),
      scoresEqual: JSON.stringify(scoresAfter) === JSON.stringify(scoresBefore),
      fixtureIdsBefore,
      fixtureIdsAfter,
      editionFocusClubId: refocus?.editionFocusClubId || refocus?.playerClubId || null,
      viewFocusClubId: refocus?.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
      adapter: "base-soft-refocus-shared-player",
    };
  } else {
    throw new Error("unknown control " + shared.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        expectedRngAfterRestore: shared.expectedRngAfterRestore,
        rngMatchesExpected: rngAfterRestore === shared.expectedRngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        inputHash: args.inputHash,
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

const prepPath = join(outDir, "_paired-prep.mjs");
const workerPath = join(outDir, "_paired-worker.mjs");
writeFileSync(prepPath, prepSrc);
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
      playerClubId: "club:england:brentford",
      placements: { 1: "club:england:arsenal", 17: "club:england:brentford" },
      invariant: "DNQ Brentford cannot inherit Arsenal first-place/CL",
      passFinal: (r) =>
        r.decisionStatus === "not-qualified" &&
        r.eligibleCount === 0 &&
        (r.editionCompetition == null || r.standing == null) &&
        r.staleArsenalRowPosition === 1 &&
        r.staleArsenalRowClubId === "club:england:arsenal",
    },
    {
      id: "F02",
      seed: 102,
      leagueId: "league:england-premier-league",
      arsenalId: "club:england:arsenal",
      brentfordId: "club:england:brentford",
      playerClubId: "club:england:arsenal",
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
      playerClubId: "club:england:brentford",
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
      playerClubId: "club:england:arsenal",
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
      playerClubId: "club:england:arsenal",
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
      playerClubId: "club:england:arsenal",
      placements: { 1: "club:england:arsenal", 2: "club:england:brentford" },
      invariant: "Soft refocus after committed MD1 preserves field/fixtures and registration gate",
      passFinal: (r) =>
        r.fieldEqual === true &&
        r.fixturesEqual === true &&
        r.scoresEqual === true &&
        r.lateEligibleAfterMove === 0 &&
        Array.isArray(r.playedMatchdays) &&
        r.playedMatchdays.length > 0,
    },
  ];

  for (const spec of specs) {
    const recipe = { ...spec };
    delete recipe.invariant;
    delete recipe.passFinal;
    const recipePath = join(outDir, "inputs", `${spec.id}.recipe.json`);
    writeFileSync(recipePath, JSON.stringify(recipe, null, 2));

    const sharedPath = join(outDir, "inputs", `${spec.id}.json`);
    const prep = spawnSync(
      process.execPath,
      [prepPath, `--root=${root}`, `--input=${recipePath}`, `--out=${sharedPath}`],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    if (prep.status !== 0) {
      throw new Error(`prep ${spec.id} failed: ${prep.stderr || prep.stdout}`);
    }
    const sharedRaw = readFileSync(sharedPath, "utf8");
    const inputHash = hashBytes(sharedRaw);
    const shared = JSON.parse(sharedRaw);
    // Rewrite with hash stamp for archival clarity (hash is of pre-stamp body above).
    shared.inputHash = inputHash;
    writeFileSync(sharedPath, JSON.stringify(shared, null, 2));
    const archivedHash = hashBytes(readFileSync(sharedPath, "utf8"));

    const baseOut = join(outDir, `${spec.id}.base-obs.json`);
    const finalOut = join(outDir, `${spec.id}.final-obs.json`);

    const baseRun = spawnSync(
      process.execPath,
      [
        workerPath,
        `--side=base`,
        `--root=${baseWork}`,
        `--input=${sharedPath}`,
        `--out=${baseOut}`,
        `--sha=${BASE_SHA}`,
        `--inputHash=${archivedHash}`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
    const finalRun = spawnSync(
      process.execPath,
      [
        workerPath,
        `--side=final`,
        `--root=${root}`,
        `--input=${sharedPath}`,
        `--out=${finalOut}`,
        `--sha=${FINAL_SHA}`,
        `--inputHash=${archivedHash}`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );

    const baseObs =
      baseRun.status === 0 && existsSync(baseOut)
        ? JSON.parse(readFileSync(baseOut, "utf8"))
        : { error: baseRun.stderr || baseRun.stdout, status: baseRun.status };
    const finalObs =
      finalRun.status === 0 && existsSync(finalOut)
        ? JSON.parse(readFileSync(finalOut, "utf8"))
        : { error: finalRun.stderr || finalRun.stdout, status: finalRun.status };

    const rngGate =
      baseRun.status === 0 &&
      finalRun.status === 0 &&
      Number(baseObs.rngAfterRestore) === Number(shared.expectedRngAfterRestore) &&
      Number(finalObs.rngAfterRestore) === Number(shared.expectedRngAfterRestore) &&
      Number(baseObs.rngAfterRestore) === Number(finalObs.rngAfterRestore);

    const pass =
      finalRun.status === 0 &&
      rngGate &&
      baseObs.inputHash === archivedHash &&
      finalObs.inputHash === archivedHash &&
      spec.passFinal(finalObs.result || {});

    const record = {
      id: spec.id,
      inputHash: archivedHash,
      inputPath: `inputs/${spec.id}.json`,
      baseSha: BASE_SHA,
      finalSha: FINAL_SHA,
      invariant: spec.invariant,
      expectedRngAfterRestore: shared.expectedRngAfterRestore,
      base: baseObs,
      current: finalObs,
      pass,
      rngGate,
      baseFailedInvariant: baseRun.status === 0 ? !spec.passFinal(baseObs.result || {}) : true,
      observationsEqual: JSON.stringify(baseObs.result) === JSON.stringify(finalObs.result),
    };
    controls.push(record);
    writeFileSync(join(outDir, `${spec.id}.json`), JSON.stringify(record, null, 2));
  }

  const summary = {
    baseSha: BASE_SHA,
    finalSha: FINAL_SHA,
    adapter: "shared full snapshot + createWorldState({seed}) + asserted RNG",
    controls: controls.map((c) => ({
      id: c.id,
      inputHash: c.inputHash,
      pass: c.pass,
      rngGate: c.rngGate,
      invariant: c.invariant,
      expectedRng: c.expectedRngAfterRestore,
      baseRng: c.base?.rngAfterRestore ?? null,
      currentRng: c.current?.rngAfterRestore ?? null,
      observationsEqual: c.observationsEqual,
      baseFailedInvariant: c.baseFailedInvariant,
    })),
    allPass: controls.every((c) => c.pass),
    allRngEqual: controls.every((c) => c.rngGate),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.allPass && summary.allRngEqual ? 0 : 1;
} finally {
  spawnSync("git", ["worktree", "remove", "--force", baseWork], { cwd: root, encoding: "utf8" });
  rmSync(baseWork, { recursive: true, force: true });
}
