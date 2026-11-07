#!/usr/bin/env node
/**
 * Matched base (accepted Fix 11) vs final Fix 12 gameplay parity.
 *
 *   node scripts/qaFix12BaseFinalParity.mjs --out qa/fix12-runs/final/gameplay-parity
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_SHA = "fa1445c731335e20d21f93cc412f451d2c77889d";
const outIdx = process.argv.indexOf("--out");
const OUT = resolve(ROOT, outIdx >= 0 ? process.argv[outIdx + 1] : "qa/fix12-runs/final/gameplay-parity");

const git = (args, cwd = ROOT) =>
  spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const finalSha = git(["rev-parse", "HEAD"]).stdout.trim();
if (finalSha === BASE_SHA) {
  console.error("Refusing same-revision parity");
  process.exit(1);
}

function sha(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

async function loadEngine(root) {
  const worldMod = await import(pathToFileURL(join(root, "js/simulation/worldState.js")).href);
  const rngMod = await import(pathToFileURL(join(root, "js/simulation/rng.js")).href);
  const pdMod = await import(pathToFileURL(join(root, "js/simulation/playerDevelopmentModel.js")).href);
  const finance = await import(pathToFileURL(join(root, "js/simulation/clubFinance.js")).href);
  const national = await import(pathToFileURL(join(root, "js/simulation/nationalTournament.js")).href);
  const continental = await import(pathToFileURL(join(root, "js/simulation/continentalTournament.js")).href);
  const leagues = await import(pathToFileURL(join(root, "js/data/leagues.js")).href);
  const euro = await import(pathToFileURL(join(root, "js/simulation/europeanCompetition.js")).href);
  return {
    ...worldMod,
    ...rngMod,
    ...pdMod,
    ...finance,
    ...national,
    ...continental,
    ...leagues,
    simulateEuropeanCampaign: euro.simulateEuropeanCampaign,
  };
}

function serbiaPlayer(engine, seed, year, qualification = "Champions League") {
  engine.resetClubFinanceLedgers();
  const world = engine.createWorldState({ seed, startYear: year });
  engine.setWorldState(world);
  const league = engine.LEAGUES.find((l) => l.nation === "Serbia");
  const club = league.clubs.find((c) => /Red Star/.test(c.name));
  const rng = engine.createRng(12);
  const player = {
    name: "Parity",
    nationality: "Serbia",
    position: "ST",
    age: 25,
    careerId: `parity-${seed}`,
    startYear: year,
    rating: 85,
    attributes: engine.generateStartingAttributes("ST", 85, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 1, qualification, points: 80 },
    },
  };
  engine.initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { world, league, club, player };
}

function f01Processor() {
  let groupGames = 0;
  return (req) => {
    const draw = req.stageType === "group" && ++groupGames === 3;
    const homeGoals = draw ? 1 : req.playerSide === "home" ? 2 : 0;
    const awayGoals = draw ? 1 : req.playerSide === "away" ? 2 : 0;
    return {
      match: {
        ...req,
        homeGoals,
        awayGoals,
        matchHomeGoals: homeGoals,
        matchAwayGoals: awayGoals,
        regulationHomeGoals: homeGoals,
        regulationAwayGoals: awayGoals,
        scoreline: `${homeGoals}-${awayGoals}`,
        winnerSide: draw ? null : req.playerSide,
        decidedBy: "regulation",
        events: [],
      },
    };
  };
}

function fingerprintNational(view, engine) {
  const fixtures = Object.values(view.fixtures || {})
    .filter((m) => m.status === "played")
    .map((m) => ({
      id: m.matchId,
      h: m.homeParticipantId || m.home?.name,
      a: m.awayParticipantId || m.away?.name,
      hg: m.matchHomeGoals ?? m.homeGoals,
      ag: m.matchAwayGoals ?? m.awayGoals,
      ph: m.penaltyHome ?? m.homePenalties ?? null,
      pa: m.penaltyAway ?? m.awayPenalties ?? null,
      stage: m.stageId,
    }))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return {
    winner: view.winner,
    result: view.result,
    fixtures,
    matchCount: fixtures.length,
    rng: engine.getSimRng?.().seed?.() ?? null,
  };
}

function fingerprintContinental(view, engine) {
  const fixtures = [
    ...(view.leaguePhase?.matches || []),
    ...((view.groups?.groups || []).flatMap((g) => g.matches || []) || []),
    ...(view.groups?.matches || []),
    ...(view.allRounds || []).flatMap((r) =>
      (r.matches || []).flatMap((m) => (m?.isAggregate ? m.legs || [] : [m]))
    ),
  ]
    .filter((m) => m && (m.status === "played" || m.homeGoals != null) && !m.isAggregate && !m.isBye)
    .map((m) => ({
      id: m.matchId,
      h: m.home?.clubId || m.home?.name,
      a: m.away?.clubId || m.away?.name,
      hg: m.matchHomeGoals ?? m.homeGoals,
      ag: m.matchAwayGoals ?? m.awayGoals,
    }))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
  const table = (view.leaguePhase?.table || view.groups?.groups?.[0]?.table || []).map((r) => ({
    clubId: r.clubId,
    p: r.played,
    w: r.wins,
    d: r.draws,
    l: r.losses,
    pts: r.points,
  }));
  return {
    competition: view.competition,
    focusClubId: view.focusClubId,
    winner: view.winner,
    table,
    fixtures,
    matchCount: fixtures.length,
    rng: engine.getSimRng?.().seed?.() ?? null,
  };
}

async function runWorldCup(engine) {
  const { world, player } = serbiaPlayer(engine, 12001, 2026);
  const ed = engine.prepareNationalEdition({
    tournament: {
      id: "world-cup",
      name: "FIFA World Cup",
      shortName: "World Cup",
      confederation: "FIFA",
      fieldSize: 48,
      groupSize: 4,
      bestThirds: 8,
      editionYear: 2026,
      year: 2026,
    },
    player,
    calledUp: true,
    forceIncludeIfEligible: true,
    calendarYear: 2026,
    world,
  });
  engine.drainNationalEdition(ed, { player, world, matchProcessor: f01Processor() });
  const view = engine.buildNationalCampaignView(ed, { player, world });
  return { id: "world-cup-12001", fp: fingerprintNational(view, engine) };
}

async function runUcl(engine) {
  const { world, league, club, player } = serbiaPlayer(engine, 7, 2026, "Champions League");
  const state = engine.prepareContinentalEdition({
    standing: player.latestStanding.playerRow,
    league,
    player,
    seasonYear: 2026,
  });
  const script = {
    1: { gf: 3, ga: 2 },
    2: { gf: 1, ga: 0 },
    3: { gf: 1, ga: 0 },
    4: { gf: 1, ga: 0 },
    5: { gf: 0, ga: 0 },
    6: { gf: 2, ga: 2 },
    7: { gf: 0, ga: 2 },
    8: { gf: 1, ga: 3 },
  };
  for (const md of state.openingMatchdays) {
    engine.processContinentalMatchday(state, md, {
      player,
      matchProcessor: (req) => {
        const sc = script[md];
        const homeIsPlayer = req.playerSide === "home";
        const homeGoals = homeIsPlayer ? sc.gf : sc.ga;
        const awayGoals = homeIsPlayer ? sc.ga : sc.gf;
        return {
          match: {
            home: req.home,
            away: req.away,
            homeGoals,
            awayGoals,
            matchHomeGoals: homeGoals,
            matchAwayGoals: awayGoals,
            regulationHomeGoals: homeGoals,
            regulationAwayGoals: awayGoals,
            playerSide: req.playerSide,
            scoreline: `${homeGoals}-${awayGoals}`,
            events: [],
          },
        };
      },
    });
  }
  // Complete remaining KO with the engine (same on base and final).
  engine.drainContinentalEdition(state, { player, world });
  const view = engine.buildContinentalCampaignView(state, { playerName: club.name, world });
  return { id: "ucl-seed7-w4d2l2", fp: fingerprintContinental(view, engine) };
}

async function runLibertadores(engine) {
  engine.resetClubFinanceLedgers();
  if (engine.reseedCareerRng) engine.reseedCareerRng(7);
  const world = engine.createWorldState({ startYear: 2026, careerSeed: 7, seed: 7 });
  engine.setWorldState(world);
  const league = engine.LEAGUES.find((l) => l.nation === "Brazil" && (l.divisionLevel ?? 1) === 1);
  const club = [...league.clubs].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
  const rng = engine.createRng(7);
  const player = {
    name: "LibParity",
    nationality: "Brazil",
    position: "ST",
    age: 24,
    careerId: "parity-lib-7",
    startYear: 2026,
    rating: 82,
    attributes: engine.generateStartingAttributes("ST", 82, 95, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 1, qualification: "League Champions", points: 90 },
    },
  };
  engine.initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  let view = null;
  const state = engine.prepareContinentalEdition({
    standing: player.latestStanding.playerRow,
    league,
    player,
    seasonYear: 2026,
  });
  if (state) {
    engine.drainContinentalEdition(state, { player, world });
    view = engine.buildContinentalCampaignView(state, { playerName: club.name, world });
  }
  if (!view) {
    view = engine.simulateEuropeanCampaign({
      standing: { position: 1, qualification: "League Champions" },
      league,
      performanceScore: 75,
      player,
      seasonYear: 2026,
    });
  }
  if (!view) throw new Error("Libertadores control failed to build campaign");
  return { id: "libertadores-seed7", fp: fingerprintContinental(view, engine) };
}

async function runAll(engine) {
  const wc = await runWorldCup(engine);
  const ucl = await runUcl(engine);
  const lib = await runLibertadores(engine);
  return [wc, ucl, lib];
}

mkdirSync(OUT, { recursive: true });
const baseDir = mkdtempSync(join(tmpdir(), "fix12-base-"));
const finalDir = ROOT;
try {
  const archivePath = join(baseDir, "base.tar");
  // Engine/data only — skip trophies/badges to keep the extract small.
  const arch = spawnSync(
    "git",
    [
      "archive",
      "--format=tar",
      "-o",
      archivePath,
      BASE_SHA,
      "js",
      "league-data.js",
      // data lives under js/data in this repo
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if (arch.status !== 0) throw new Error(arch.stderr || arch.stdout || "git archive failed");
  const tar = spawnSync("tar", ["-xf", archivePath, "-C", baseDir], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(tar.stderr || "tar extract failed");
  rmSync(archivePath, { force: true });

  const baseEngine = await loadEngine(baseDir);
  const finalEngine = await loadEngine(finalDir);
  const baseControls = await runAll(baseEngine);
  const finalControls = await runAll(finalEngine);

  const controls = baseControls.map((b, i) => {
    const f = finalControls[i];
    const baseHash = sha(b.fp);
    const finalHash = sha(f.fp);
    const matched =
      baseHash === finalHash &&
      b.fp.matchCount === f.fp.matchCount &&
      JSON.stringify(b.fp.fixtures) === JSON.stringify(f.fp.fixtures);
    writeFileSync(join(OUT, `${b.id}-base.json`), JSON.stringify(b.fp, null, 2));
    writeFileSync(join(OUT, `${b.id}-final.json`), JSON.stringify(f.fp, null, 2));
    return {
      id: b.id,
      matched,
      baseHash,
      finalHash,
      baseMatchCount: b.fp.matchCount,
      finalMatchCount: f.fp.matchCount,
      baseRng: b.fp.rng,
      finalRng: f.fp.rng,
    };
  });

  const pairDigests = {};
  for (const c of controls) {
    for (const side of ["base", "final"]) {
      const name = `${c.id}-${side}.json`;
      const abs = join(OUT, name);
      if (existsSync(abs)) {
        pairDigests[name] = createHash("sha256").update(readFileSync(abs)).digest("hex");
      }
    }
  }

  const result = {
    schema: 1,
    baseSha: BASE_SHA,
    finalSha,
    sameRevisionOnly: false,
    nationalParity: controls.find((c) => c.id.startsWith("world-cup"))?.matched ?? false,
    continentalParity: controls.find((c) => c.id.startsWith("ucl"))?.matched ?? false,
    controls,
    pairDigests,
    ok: controls.every((c) => c.matched),
  };
  writeFileSync(join(OUT, "parity-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} finally {
  rmSync(baseDir, { recursive: true, force: true });
}
